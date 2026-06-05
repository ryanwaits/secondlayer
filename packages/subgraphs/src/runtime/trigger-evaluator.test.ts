import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type {
	Block,
	Event,
	Subscription,
	Transaction,
} from "@secondlayer/shared/db";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import type { ChainTrigger } from "@secondlayer/shared/schemas/subscriptions";
import type { BlockData } from "./batch-loader.ts";
import type { TraitContracts } from "./source-matcher.ts";
import {
	buildSourcesMap,
	chainTriggerToFilter,
	emitChainOutbox,
	evaluateBlock,
	referencedEventTypes,
} from "./trigger-evaluator.ts";

// DB-backed tests use the same local Postgres convention as the queries tests.
process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

function chainSub(triggers: ChainTrigger[], id = randomUUID()): Subscription {
	return {
		id,
		kind: "chain",
		subgraph_name: null,
		table_name: null,
		triggers,
	} as unknown as Subscription;
}

function tx(o: Partial<Transaction>): Transaction {
	return {
		tx_id: "0xtx",
		block_height: 100,
		tx_index: 0,
		type: "contract_call",
		sender: "SP1",
		status: "success",
		contract_id: null,
		function_name: null,
		function_args: null,
		raw_result: null,
		raw_tx: "",
		created_at: new Date(0),
		...o,
	} as Transaction;
}

function ev(o: Partial<Event>): Event {
	return {
		id: "0xtx#0",
		tx_id: "0xtx",
		block_height: 100,
		event_index: 0,
		type: "ft_transfer_event",
		data: {},
		created_at: new Date(0),
		...o,
	} as Event;
}

function block(txs: Transaction[], events: Event[]): BlockData {
	return { block: { hash: "0xblock" } as Block, txs, events };
}

describe("chainTriggerToFilter", () => {
	it("coerces amount strings/numbers to bigint", () => {
		const f = chainTriggerToFilter({
			type: "stx_transfer",
			minAmount: "1000000",
			maxAmount: 5,
		}) as { minAmount?: bigint; maxAmount?: bigint };
		expect(f.minAmount).toBe(1000000n);
		expect(f.maxAmount).toBe(5n);
	});
});

describe("buildSourcesMap", () => {
	it("keys each trigger as {subId}#{idx} and records readable meta", () => {
		const sub = chainSub([
			{ type: "contract_call", contractId: "SP1.amm" },
			{ type: "ft_transfer", trait: "sip-010" },
		]);
		const { sources, keyMeta } = buildSourcesMap([sub]);
		expect(Object.keys(sources)).toEqual([`${sub.id}#0`, `${sub.id}#1`]);
		expect(keyMeta.get(`${sub.id}#1`)).toEqual({
			subscriptionId: sub.id,
			triggerIndex: 1,
			triggerType: "ft_transfer",
		});
	});
});

describe("referencedEventTypes", () => {
	it("returns just the referenced event types for event triggers", () => {
		const types = referencedEventTypes([chainSub([{ type: "ft_transfer" }])]);
		expect(types).toEqual(["ft_transfer"]);
	});

	it("returns ALL index event types when a contract_call trigger is present", () => {
		const types = referencedEventTypes([
			chainSub([{ type: "contract_call" }, { type: "ft_transfer" }]),
		]);
		expect(types.length).toBeGreaterThan(1);
		expect(types).toContain("stx_transfer");
		expect(types).toContain("print");
	});
});

describe("evaluateBlock", () => {
	it("matches a contract_call trigger and routes by source key", () => {
		const sub = chainSub([
			{ type: "contract_call", contractId: "SP1.amm", functionName: "swap-*" },
		]);
		const { sources, keyMeta } = buildSourcesMap([sub]);
		const matches = evaluateBlock(
			block(
				[
					tx({
						type: "contract_call",
						contract_id: "SP1.amm",
						function_name: "swap-x-for-y",
					}),
				],
				[],
			),
			sources,
			new Map(),
		);
		expect(matches).toHaveLength(1);
		expect(keyMeta.get(matches[0].sourceName)?.subscriptionId).toBe(sub.id);
	});

	it("honors trait scope via the injected trait→contracts map", () => {
		const sub = chainSub([{ type: "ft_transfer", trait: "sip-010" }]);
		const { sources } = buildSourcesMap([sub]);
		const b = block(
			[tx({ type: "contract_call" })],
			[
				ev({
					type: "ft_transfer_event",
					data: {
						asset_identifier: "SP1.token::tok",
						sender: "SPa",
						recipient: "SPb",
						amount: "100",
					},
				}),
			],
		);
		const conforming: TraitContracts = new Map([
			["sip-010", new Set(["SP1.token"])],
		]);
		expect(evaluateBlock(b, sources, conforming)).toHaveLength(1);
		// Empty trait map → contract doesn't conform → no match.
		expect(evaluateBlock(b, sources, new Map())).toHaveLength(0);
	});
});

describe("emitChainOutbox (DB)", () => {
	const db = getDb();
	const accountId = randomUUID();

	afterAll(async () => {
		await db
			.deleteFrom("subscriptions")
			.where("account_id", "=", accountId)
			.execute();
	});

	beforeEach(async () => {
		await db
			.deleteFrom("subscriptions")
			.where("account_id", "=", accountId)
			.execute();
	});

	async function makeChainSub(triggers: ChainTrigger[]): Promise<Subscription> {
		const { subscription } = await createSubscription(db, {
			accountId,
			name: `eval-${randomUUID()}`,
			kind: "chain",
			triggers,
			url: "https://webhook.site/eval",
		});
		return subscription;
	}

	async function outboxRows(subscriptionId: string) {
		return db
			.selectFrom("subscription_outbox")
			.selectAll()
			.where("subscription_id", "=", subscriptionId)
			.execute();
	}

	it("emits one apply row per matched contract_call tx (event_index -1) and is idempotent", async () => {
		const sub = await makeChainSub([
			{ type: "contract_call", contractId: "SP1.amm" },
		]);
		const { sources, keyMeta } = buildSourcesMap([sub]);
		const b = block(
			[
				tx({
					tx_id: "0xa",
					type: "contract_call",
					contract_id: "SP1.amm",
					function_name: "swap",
				}),
			],
			[],
		);
		const matches = evaluateBlock(b, sources, new Map());

		const first = await emitChainOutbox(db, matches, keyMeta, 100, "0xblock");
		expect(first).toBe(1);
		// Re-emit the same block → dedup constraint suppresses duplicates.
		await emitChainOutbox(db, matches, keyMeta, 100, "0xblock");

		const rows = await outboxRows(sub.id);
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe("chain");
		expect(rows[0].event_type).toBe("chain.contract_call.apply");
		expect(rows[0].dedup_key).toBe(`chain:${sub.id}:0xa:-1:0xblock`);
		const payload = rows[0].payload as Record<string, unknown>;
		expect(payload.action).toBe("apply");
		expect(payload.block_hash).toBe("0xblock");
	});

	it("emits one apply row per matched event for event-level triggers", async () => {
		const sub = await makeChainSub([{ type: "ft_transfer" }]);
		const { sources, keyMeta } = buildSourcesMap([sub]);
		const b = block(
			[tx({ tx_id: "0xb", type: "contract_call" })],
			[
				ev({
					tx_id: "0xb",
					event_index: 3,
					type: "ft_transfer_event",
					data: {
						asset_identifier: "SP1.t::x",
						sender: "A",
						recipient: "B",
						amount: "1",
					},
				}),
			],
		);
		const matches = evaluateBlock(b, sources, new Map());
		const n = await emitChainOutbox(db, matches, keyMeta, 100, "0xblock");
		expect(n).toBe(1);
		const rows = await outboxRows(sub.id);
		expect(rows[0].dedup_key).toBe(`chain:${sub.id}:0xb:3:0xblock`);
		expect(rows[0].event_type).toBe("chain.ft_transfer.apply");
	});
});
