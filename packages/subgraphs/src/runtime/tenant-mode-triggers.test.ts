import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import type {
	IndexHttpClient,
	IndexSbtcEventRow,
} from "@secondlayer/shared/index-http";
import type { ChainTrigger } from "@secondlayer/shared/schemas/webhooks";
import { runEvaluatorOnce } from "./trigger-evaluator-loop.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

/**
 * A hosted tenant's `webhook-service` reads chain data from the hosted Index
 * API; its own Postgres has the chain tables but no chain rows. Every trigger
 * family must read the hosted API there, and a stack with a local chain must
 * keep reading its own tables without a single extra HTTP call.
 */

const db = getDb();
const HEIGHT = 6_237_001;
const ACCEPT_HEIGHT = HEIGHT - 50;
const BLOCK_TIME = "2026-10-15T00:00:00.000Z";
const TOKEN = "SP2TENANTTOKEN.tenant-token";
const NAME_PREFIX = `tenant-mode-${randomUUID()}-`;
const TX_PREFIX = `0xtenant-${randomUUID().slice(0, 8)}`;
const SWEEP = `${TX_PREFIX}-sweep`;
/** The tenant has no `index_progress` row on this network; the self-host
 *  stack below seeds one on its own. Neither touches the shared mainnet row
 *  other suites write. */
const TENANT_NETWORK = "testnet";
const LOCAL_NETWORK = "devnet";

const savedEnv = {
	SUBGRAPH_SOURCE: process.env.SUBGRAPH_SOURCE,
	SUBGRAPH_INDEX_API_URL: process.env.SUBGRAPH_INDEX_API_URL,
	NETWORK: process.env.NETWORK,
};

function sbtcEvent(
	overrides: Partial<IndexSbtcEventRow> & {
		topic: string;
		tx_id: string;
		event_index: number;
	},
): IndexSbtcEventRow {
	return {
		cursor: `${overrides.block_height ?? HEIGHT}:${overrides.event_index}`,
		block_height: HEIGHT,
		block_time: BLOCK_TIME,
		tx_index: 0,
		request_id: null,
		amount: null,
		sender: null,
		recipient_btc_version: null,
		recipient_btc_hashbytes: null,
		bitcoin_txid: null,
		output_index: null,
		sweep_txid: null,
		burn_hash: null,
		burn_height: null,
		signer_bitmap: null,
		max_fee: null,
		fee: null,
		governance_contract_type: null,
		governance_new_contract: null,
		signer_aggregate_pubkey: null,
		signer_threshold: null,
		signer_address: null,
		signer_keys_count: null,
		...overrides,
	};
}

/** One deposit + one withdrawal request at HEIGHT, and the accept event that
 *  committed the sweep. */
const SBTC_EVENTS: IndexSbtcEventRow[] = [
	sbtcEvent({
		topic: "completed-deposit",
		tx_id: `${TX_PREFIX}-deposit`,
		event_index: 0,
		amount: "250000",
		sender: "SP3DEPOSITOR",
		bitcoin_txid: `${TX_PREFIX}-btc`,
		output_index: 0,
	}),
	sbtcEvent({
		topic: "withdrawal-create",
		tx_id: `${TX_PREFIX}-create`,
		event_index: 1,
		request_id: 91,
		amount: "70000",
		sender: "SP4WITHDRAWER",
	}),
	sbtcEvent({
		topic: "withdrawal-accept",
		tx_id: `${TX_PREFIX}-accept`,
		block_height: ACCEPT_HEIGHT,
		event_index: 2,
		request_id: 91,
		sweep_txid: SWEEP,
	}),
];

type FakeIndex = IndexHttpClient & { calls: string[] };

/** Hosted Index serving HEIGHT (one sip-010 transfer, the sBTC events above)
 *  and one sweep confirmed at `confirmedAt`. `failSbtc` makes the sBTC event
 *  read fail. Records every sBTC/trait/settlement call. */
function fakeHostedIndex(opts: {
	confirmedAt: Date;
	failSbtc?: boolean;
}): FakeIndex {
	const calls: string[] = [];
	const blockRow = (h: number) => ({
		block_height: h,
		block_hash: `0xtenant${h}`,
		parent_hash: `0xtenant${h - 1}`,
		burn_block_height: h,
		burn_block_hash: null,
		block_time: BLOCK_TIME,
	});
	return {
		calls,
		getIndexTip: async () => HEIGHT,
		getIndexSourceTip: async () => HEIGHT,
		getDecodedHeights: () => undefined,
		waitIsSupported: () => true,
		walkBlocks: async (from: number, to: number) => {
			const rows = [];
			for (let h = from; h <= to; h++) rows.push(blockRow(h));
			return rows;
		},
		walkTransactions: async () => [],
		walkEvents: async (type: string, from: number, to: number) =>
			type === "ft_transfer" && HEIGHT >= from && HEIGHT <= to
				? [
						{
							event_type: "ft_transfer",
							block_height: HEIGHT,
							tx_id: `${TX_PREFIX}-ft`,
							tx_index: 1,
							event_index: 3,
							contract_id: TOKEN,
							tx_sender: "SP1SENDER",
							tx_type: "contract_call",
							tx_status: "success",
							asset_identifier: `${TOKEN}::tok`,
							sender: "SP1SENDER",
							recipient: "SP2RECIPIENT",
							amount: "5000",
						},
					]
				: [],
		fetchSbtcEvents: async (
			from: number,
			to: number,
			topics: readonly string[],
			query?: { requestId?: number },
		) => {
			calls.push("fetchSbtcEvents");
			if (opts.failSbtc) throw new Error("hosted Index unavailable");
			return SBTC_EVENTS.filter(
				(e) =>
					e.block_height >= from &&
					e.block_height <= to &&
					topics.includes(e.topic) &&
					(query?.requestId === undefined || e.request_id === query.requestId),
			);
		},
		listContractsByTrait: async (trait: string) => {
			calls.push("listContractsByTrait");
			return trait === "sip-010"
				? [
						{
							contract_id: TOKEN,
							deployer: "SP2TENANTTOKEN",
							block_height: 100,
							declared_traits: ["sip-010"],
							inferred_standards: [],
							abi_status: "fetched",
						},
					]
				: [];
		},
		fetchSettledWithdrawals: async (after: Date) => {
			calls.push("fetchSettledWithdrawals");
			return opts.confirmedAt > after
				? [
						{
							cursor: `${HEIGHT}:1`,
							request_id: 91,
							status: "ACCEPTED",
							amount: "70000",
							sender: "SP4WITHDRAWER",
							recipient_btc_version: 0,
							recipient_btc_hashbytes: "0xabcd",
							sweep_txid: SWEEP,
							settlement_confirmed: true,
							btc_confirmations: 6,
							btc_block_height: 920_000,
							confirmed_at: opts.confirmedAt.toISOString(),
						},
					]
				: [];
		},
	} as unknown as FakeIndex;
}

let webhookIds: string[] = [];

async function makeWebhook(trigger: ChainTrigger): Promise<string> {
	const { webhook } = await createWebhook(db, {
		accountId: randomUUID(),
		name: `${NAME_PREFIX}${randomUUID()}`,
		triggers: [trigger],
		url: "https://webhook.site/tenant-mode",
	});
	webhookIds.push(webhook.id);
	return webhook.id;
}

async function pauseWebhooks(ids: string[]): Promise<void> {
	await db
		.updateTable("webhooks")
		.set({ status: "paused" })
		.where("id", "in", ids)
		.execute();
}

async function outboxFor(webhookId: string) {
	return db
		.selectFrom("webhook_outbox")
		.select(["event_type", "dedup_key", "block_height", "payload"])
		.where("webhook_id", "=", webhookId)
		.orderBy("dedup_key")
		.execute();
}

async function setCursors(settlementScanAt: Date | null): Promise<void> {
	await db
		.updateTable("trigger_evaluator_state")
		.set({
			last_processed_block: HEIGHT - 1,
			last_settlement_scan_at: settlementScanAt,
		})
		.where("id", "=", true)
		.execute();
}

async function blockCursor(): Promise<number> {
	const row = await db
		.selectFrom("trigger_evaluator_state")
		.select("last_processed_block")
		.where("id", "=", true)
		.executeTakeFirstOrThrow();
	return Number(row.last_processed_block);
}

/** A stack with a local chain: its own progress row, sBTC events, the accept
 *  block and the sweep's settlement, mirroring what the fake serves. */
async function seedLocalChain(confirmedAt: Date): Promise<void> {
	process.env.NETWORK = LOCAL_NETWORK;
	await db
		.insertInto("index_progress")
		.values({
			network: LOCAL_NETWORK,
			last_indexed_block: HEIGHT,
			last_contiguous_block: HEIGHT,
			highest_seen_block: HEIGHT,
		})
		.onConflict((oc) => oc.column("network").doNothing())
		.execute();
	await db
		.insertInto("sbtc_events")
		.values(
			SBTC_EVENTS.map((e) => ({
				cursor: e.cursor,
				block_height: e.block_height,
				block_time: new Date(BLOCK_TIME),
				tx_id: e.tx_id,
				tx_index: e.tx_index,
				event_index: e.event_index,
				topic: e.topic as "completed-deposit",
				request_id: e.request_id,
				amount: e.amount,
				sender: e.sender,
				bitcoin_txid: e.bitcoin_txid,
				output_index: e.output_index,
				sweep_txid: e.sweep_txid,
				source_cursor: e.cursor,
			})),
		)
		.execute();
	await db
		.insertInto("blocks")
		.values({
			height: ACCEPT_HEIGHT,
			hash: `0xtenant${ACCEPT_HEIGHT}`,
			parent_hash: `0xtenant${ACCEPT_HEIGHT - 1}`,
			burn_block_height: ACCEPT_HEIGHT,
			burn_block_hash: null,
			timestamp: Date.parse(BLOCK_TIME) / 1000,
			canonical: true,
		})
		.execute();
	await db
		.insertInto("sbtc_settlements")
		.values({
			sweep_txid: SWEEP,
			request_id: 91,
			btc_confirmations: 6,
			settlement_confirmed: true,
			block_height: 920_000,
			confirmed_at: confirmedAt,
		})
		.execute();
}

async function cleanup(): Promise<void> {
	if (webhookIds.length > 0) {
		await db
			.deleteFrom("webhook_outbox")
			.where("webhook_id", "in", webhookIds)
			.execute();
		await db.deleteFrom("webhooks").where("id", "in", webhookIds).execute();
	}
	webhookIds = [];
	await db
		.deleteFrom("sbtc_settlements")
		.where("sweep_txid", "=", SWEEP)
		.execute();
	await db
		.deleteFrom("sbtc_events")
		.where("tx_id", "like", `${TX_PREFIX}%`)
		.execute();
	await db.deleteFrom("blocks").where("height", "=", ACCEPT_HEIGHT).execute();
	await db
		.deleteFrom("index_progress")
		.where("network", "=", LOCAL_NETWORK)
		.execute();
}

describe("chain webhooks on a hosted tenant vs a stack with a local chain", () => {
	let confirmedAt: Date;

	beforeEach(async () => {
		await cleanup();
		process.env.SUBGRAPH_SOURCE = "streams-index";
		process.env.SUBGRAPH_INDEX_API_URL = "http://index.invalid";
		process.env.NETWORK = TENANT_NETWORK;
		confirmedAt = new Date(Date.now() + 60_000);
		await setCursors(new Date(Date.now() - 60_000));
	});

	afterEach(async () => {
		await cleanup();
		await db
			.updateTable("trigger_evaluator_state")
			.set({ last_processed_block: 0, last_settlement_scan_at: null })
			.where("id", "=", true)
			.execute();
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("tenant evaluator delivers an sbtc deposit read from hosted Index", async () => {
		const id = await makeWebhook({ type: "sbtc_deposit" });
		await runEvaluatorOnce(db, {
			httpClient: fakeHostedIndex({ confirmedAt }),
		});
		const rows = await outboxFor(id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.event_type).toBe("chain.sbtc_deposit.apply");
	});

	it("tenant evaluator matches a sip-010 transfer by trait from hosted contracts", async () => {
		const id = await makeWebhook({ type: "ft_transfer", trait: "sip-010" });
		await runEvaluatorOnce(db, {
			httpClient: fakeHostedIndex({ confirmedAt }),
		});
		const rows = await outboxFor(id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.event_type).toBe("chain.ft_transfer.apply");
	});

	it("tenant settlement scan delivers a swept-confirmed withdrawal once", async () => {
		const id = await makeWebhook({ type: "sbtc_withdrawal_swept_confirmed" });
		const http = fakeHostedIndex({ confirmedAt });
		await runEvaluatorOnce(db, { httpClient: http });
		// A second scan from an older watermark sees the same sweep again.
		await setCursors(new Date(Date.now() - 60_000));
		await runEvaluatorOnce(db, { httpClient: http });
		const rows = await outboxFor(id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.dedup_key).toBe(`settlement:${id}:${SWEEP}`);
	});

	it("hosted Index error defers the batch instead of skipping sbtc deliveries", async () => {
		const id = await makeWebhook({ type: "sbtc_deposit" });
		await expect(
			runEvaluatorOnce(db, {
				httpClient: fakeHostedIndex({ confirmedAt, failSbtc: true }),
			}),
		).rejects.toThrow(/hosted Index unavailable/);
		expect(await blockCursor()).toBe(HEIGHT - 1);
		expect(await outboxFor(id)).toHaveLength(0);

		await runEvaluatorOnce(db, {
			httpClient: fakeHostedIndex({ confirmedAt }),
		});
		expect(await blockCursor()).toBe(HEIGHT);
		expect(await outboxFor(id)).toHaveLength(1);
	});

	it("self-host evaluator still reads sbtc_events from its own database", async () => {
		await seedLocalChain(confirmedAt);
		const id = await makeWebhook({ type: "sbtc_deposit" });
		const traitId = await makeWebhook({
			type: "ft_transfer",
			trait: "sip-010",
		});
		const http = fakeHostedIndex({ confirmedAt });
		await runEvaluatorOnce(db, { httpClient: http });
		expect(await outboxFor(id)).toHaveLength(1);
		// Its own (empty) registry, not the hosted one.
		expect(await outboxFor(traitId)).toHaveLength(0);
		expect(http.calls).toEqual([]);
	});

	it("tenant and self-host produce identical sbtc delivery payloads for the same event", async () => {
		const triggers: ChainTrigger[] = [
			{ type: "sbtc_deposit" },
			{ type: "sbtc_withdrawal_create" },
			{ type: "sbtc_withdrawal_swept_confirmed" },
		];
		const scanFrom = new Date(Date.now() - 60_000);

		await seedLocalChain(confirmedAt);
		const local = await Promise.all(triggers.map(makeWebhook));
		await runEvaluatorOnce(db, {
			httpClient: fakeHostedIndex({ confirmedAt }),
		});
		await pauseWebhooks(local);

		process.env.NETWORK = TENANT_NETWORK;
		await setCursors(scanFrom);
		const tenant = await Promise.all(triggers.map(makeWebhook));
		const http = fakeHostedIndex({ confirmedAt });
		await runEvaluatorOnce(db, { httpClient: http });
		expect(http.calls).not.toEqual([]);

		for (const [i, localId] of local.entries()) {
			const localRows = await outboxFor(localId);
			const tenantRows = await outboxFor(tenant[i] as string);
			expect(localRows).toHaveLength(1);
			expect(JSON.stringify(tenantRows.map((r) => r.payload))).toBe(
				JSON.stringify(localRows.map((r) => r.payload)),
			);
			expect(
				tenantRows.map((r) => r.dedup_key.replace(tenant[i] as string, "W")),
			).toEqual(localRows.map((r) => r.dedup_key.replace(localId, "W")));
		}
	});
});
