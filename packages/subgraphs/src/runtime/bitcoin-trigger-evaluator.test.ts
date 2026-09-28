import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import type { ChainTrigger } from "@secondlayer/shared/schemas/webhooks";
import type { RuneStreamsEvent } from "@secondlayer/shared/streams-rows";
import {
	type BitcoinStreamsSource,
	advanceBitcoinCursor,
	emitRuneOutbox,
	matchRuneTrigger,
	referencedRuneEventTypes,
	runBitcoinEvaluatorOnce,
	runeSubsOf,
} from "./bitcoin-trigger-evaluator.ts";
import {
	bumpChainReorgGeneration,
	getChainReorgGeneration,
} from "./trigger-evaluator-loop.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const db = getDb();
const accountId = randomUUID();
// OSS/tenant mode stores every webhook under the empty account id regardless
// of what's passed (see chain-reorg.test.ts's identical comment) — tag the
// webhook NAME with this run's random id instead, so cleanup actually finds
// its own rows and never leaks into the shared dev DB.
const NAME_PREFIX = `btc-trigger-${accountId}-`;

afterAll(async () => {
	await db
		.deleteFrom("webhooks")
		.where("name", "like", `${NAME_PREFIX}%`)
		.execute();
});

beforeEach(async () => {
	await db
		.deleteFrom("webhooks")
		.where("name", "like", `${NAME_PREFIX}%`)
		.execute();
	await setBitcoinCursor(null);
});

async function setBitcoinCursor(cursor: string | null): Promise<void> {
	await db
		.updateTable("trigger_evaluator_state")
		.set({ bitcoin_last_cursor: cursor })
		.where("id", "=", true)
		.execute();
}

async function bitcoinCursor(): Promise<string | null> {
	const row = await db
		.selectFrom("trigger_evaluator_state")
		.select("bitcoin_last_cursor")
		.where("id", "=", true)
		.executeTakeFirstOrThrow();
	return row.bitcoin_last_cursor;
}

async function makeSub(triggers: ChainTrigger[]): Promise<string> {
	const { webhook } = await createWebhook(db, {
		accountId,
		name: `${NAME_PREFIX}${randomUUID()}`,
		kind: "chain",
		triggers,
		url: "https://webhook.site/runes",
	});
	return webhook.id;
}

async function outboxRows(webhookId: string) {
	return db
		.selectFrom("webhook_outbox")
		.selectAll()
		.where("webhook_id", "=", webhookId)
		.execute();
}

function runeEvent(
	overrides: Partial<RuneStreamsEvent> = {},
): RuneStreamsEvent {
	return {
		cursor: "968100:0",
		chain: "bitcoin",
		block_height: 968_100,
		block_hash: "0xbtc968100",
		tx_id: "0xtx1",
		tx_index: 0,
		event_index: 0,
		event_type: "rune_transfer",
		rune_id: "840000:3",
		payload: { amount: "1000" },
		...overrides,
	};
}

/** A stub `BitcoinStreamsSource` — no HTTP, just canned responses, with call
 *  counters so a test can assert loadEvents was (or wasn't) reached. */
function stubSource(opts: {
	tip: number;
	events?: RuneStreamsEvent[];
	nextCursor?: string | null;
}): BitcoinStreamsSource & { loadEventsCalls: number } {
	const source = {
		loadEventsCalls: 0,
		async getTip() {
			return opts.tip;
		},
		async loadEvents() {
			source.loadEventsCalls++;
			return {
				events: opts.events ?? [],
				nextCursor: opts.nextCursor ?? null,
			};
		},
	};
	return source;
}

describe("matchRuneTrigger", () => {
	it("a rune_etch trigger with no rune filter matches any rune_etch event", () => {
		const trigger: ChainTrigger = { type: "rune_etch" };
		const event = runeEvent({ event_type: "rune_etch", rune_id: "840001:5" });
		expect(matchRuneTrigger(trigger, event)).toBe(true);
	});

	it("rejects a trigger/event type mismatch", () => {
		const trigger: ChainTrigger = { type: "rune_mint" };
		const event = runeEvent({ event_type: "rune_transfer" });
		expect(matchRuneTrigger(trigger, event)).toBe(false);
	});

	it("a rune filter only matches the same rune_id", () => {
		const trigger: ChainTrigger = { type: "rune_burn", rune: "840000:3" };
		expect(
			matchRuneTrigger(
				trigger,
				runeEvent({ event_type: "rune_burn", rune_id: "840000:3" }),
			),
		).toBe(true);
		expect(
			matchRuneTrigger(
				trigger,
				runeEvent({ event_type: "rune_burn", rune_id: "840000:4" }),
			),
		).toBe(false);
	});

	it("rune_transfer filters by address", () => {
		const trigger: ChainTrigger = {
			type: "rune_transfer",
			address: "bc1qexample",
		};
		expect(
			matchRuneTrigger(
				trigger,
				runeEvent({ payload: { amount: "1000", address: "bc1qexample" } }),
			),
		).toBe(true);
		expect(
			matchRuneTrigger(
				trigger,
				runeEvent({ payload: { amount: "1000", address: "bc1qother" } }),
			),
		).toBe(false);
	});

	it("rune_transfer filters by minAmount, inclusive", () => {
		const trigger: ChainTrigger = { type: "rune_transfer", minAmount: "1000" };
		expect(
			matchRuneTrigger(trigger, runeEvent({ payload: { amount: "1000" } })),
		).toBe(true);
		expect(
			matchRuneTrigger(trigger, runeEvent({ payload: { amount: "999" } })),
		).toBe(false);
	});

	it("address/minAmount are ignored on non-transfer trigger types (schema-level only)", () => {
		// rune_etch/mint/burn triggers don't carry address/minAmount at all —
		// this just confirms the matcher never reads those fields for them.
		const trigger: ChainTrigger = { type: "rune_mint", rune: "840000:3" };
		expect(
			matchRuneTrigger(
				trigger,
				runeEvent({ event_type: "rune_mint", rune_id: "840000:3" }),
			),
		).toBe(true);
	});
});

describe("runeSubsOf / referencedRuneEventTypes", () => {
	it("excludes a webhook whose triggers are all Stacks", async () => {
		const sub = await makeSub([{ type: "contract_call" }]);
		const subs = await db
			.selectFrom("webhooks")
			.selectAll()
			.where("id", "=", sub)
			.execute();
		expect(runeSubsOf(subs)).toEqual([]);
	});

	it("includes a webhook with a mix of Stacks and Runes triggers", async () => {
		const sub = await makeSub([
			{ type: "contract_call" },
			{ type: "rune_transfer", rune: "840000:3" },
		]);
		const subs = await db
			.selectFrom("webhooks")
			.selectAll()
			.where("id", "=", sub)
			.execute();
		expect(runeSubsOf(subs)).toHaveLength(1);
		expect(referencedRuneEventTypes(runeSubsOf(subs))).toEqual([
			"rune_transfer",
		]);
	});
});

describe("runBitcoinEvaluatorOnce", () => {
	it("fast-forwards a fresh cursor straight to tip and never calls loadEvents", async () => {
		await makeSub([{ type: "rune_transfer" }]);
		const source = stubSource({ tip: 968_500 });

		const result = await runBitcoinEvaluatorOnce(db, source);

		expect(result).toEqual({ emitted: 0, advanced: true });
		expect(source.loadEventsCalls).toBe(0);
		expect(await bitcoinCursor()).toBe("968500:2147483647");
	});

	it("fast-forwards every tick while there are no active Runes webhooks, even with a cursor already set", async () => {
		await makeSub([{ type: "contract_call" }]); // Stacks-only — invisible here
		await setBitcoinCursor("968000:0");
		const source = stubSource({ tip: 968_600 });

		const result = await runBitcoinEvaluatorOnce(db, source);

		expect(result.emitted).toBe(0);
		expect(source.loadEventsCalls).toBe(0);
		expect(await bitcoinCursor()).toBe("968600:2147483647");
	});

	it("loads a page, matches, emits an apply row per match, and advances the cursor", async () => {
		const sub = await makeSub([
			{ type: "rune_transfer", rune: "840000:3", minAmount: "500" },
		]);
		await setBitcoinCursor("968099:0");
		const matching = runeEvent({
			tx_id: "0xmatch",
			payload: { amount: "1000" },
		});
		const nonMatching = runeEvent({
			tx_id: "0xno-match",
			rune_id: "840000:4", // different rune
		});
		const source = stubSource({
			tip: 968_200,
			events: [matching, nonMatching],
			nextCursor: "968100:1",
		});

		const result = await runBitcoinEvaluatorOnce(db, source);

		expect(result).toEqual({ emitted: 1, advanced: true });
		expect(await bitcoinCursor()).toBe("968100:1");

		const rows = await outboxRows(sub);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.event_type).toBe("chain.rune_transfer.apply");
		expect(rows[0]?.dedup_key).toBe(`btc:${sub}:0xmatch:0:0xbtc968100`);
		expect(rows[0]?.block_time).toBeNull();
		const payload = rows[0]?.payload as {
			chain: string;
			rune_id: string;
			trigger: string;
			event: { amount: string };
		};
		expect(payload.chain).toBe("bitcoin");
		expect(payload.rune_id).toBe("840000:3");
		expect(payload.trigger).toBe("rune_transfer");
		expect(payload.event.amount).toBe("1000");
	});

	it("re-processing the same page is idempotent (dedup_key unique constraint)", async () => {
		const sub = await makeSub([{ type: "rune_etch" }]);
		const event = runeEvent({ event_type: "rune_etch", tx_id: "0xetch" });

		const first = await emitRuneOutbox(
			db,
			[event],
			[{ id: sub, triggers: [{ type: "rune_etch" }] } as never],
		);
		const second = await emitRuneOutbox(
			db,
			[event],
			[{ id: sub, triggers: [{ type: "rune_etch" }] } as never],
		);

		expect(first).toBe(1);
		expect(second).toBe(0); // ON CONFLICT DO NOTHING — already inserted
		expect(await outboxRows(sub)).toHaveLength(1);
	});
});

describe("advanceBitcoinCursor generation guard", () => {
	it("a stale advance snapshotted before a reorg cannot overwrite the rewind", async () => {
		await setBitcoinCursor("968100:0");
		const gen0 = getChainReorgGeneration();

		bumpChainReorgGeneration();
		await setBitcoinCursor("968000:0"); // simulates handleChainReorg's rewind

		const result = await advanceBitcoinCursor(db, "968200:0", gen0);

		expect(result).toEqual({ advanced: false, reorged: true });
		expect(await bitcoinCursor()).toBe("968000:0");
	});

	it("an advance at the current generation moves the cursor forward", async () => {
		await setBitcoinCursor("968000:0");
		const gen = getChainReorgGeneration();

		const result = await advanceBitcoinCursor(db, "968100:5", gen);

		expect(result).toEqual({ advanced: true, reorged: false });
		expect(await bitcoinCursor()).toBe("968100:5");
	});

	it("never moves the cursor backward", async () => {
		await setBitcoinCursor("968100:5");
		const gen = getChainReorgGeneration();

		const result = await advanceBitcoinCursor(db, "968050:0", gen);

		expect(result).toEqual({ advanced: false, reorged: false });
		expect(await bitcoinCursor()).toBe("968100:5");
	});
});
