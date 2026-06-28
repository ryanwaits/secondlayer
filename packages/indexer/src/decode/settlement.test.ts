import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type { SbtcEventTopic } from "@secondlayer/shared/db/schema";
import type { TxConfirmation } from "./bitcoin-rpc.ts";
import { handleSbtcReorg } from "./sbtc-storage.ts";
import {
	SETTLEMENT_CONFIRMER_NAME,
	consumeSbtcSettlements,
	deleteOrphanedSettlements,
	getSettlementConfirmerHealth,
	readPendingSweeps,
} from "./settlement.ts";
import { getEnabledDecoderNames } from "./storage.ts";

const HAS_DB = !!process.env.DATABASE_URL;

// --- decoupling guard (no DB) ------------------------------------------------
// Locks in that the confirmer is NOT in the enabled-decoder set, so a future
// edit can't silently re-break plan 021's floor-audit (which iterates that set
// and would flag this floorless worker as "unbaselined").
describe("settlement confirmer / floor-audit decoupling", () => {
	test("getEnabledDecoderNames never includes the confirmer", () => {
		expect(getEnabledDecoderNames({})).not.toContain(SETTLEMENT_CONFIRMER_NAME);
		expect(
			getEnabledDecoderNames({
				SBTC_DECODER_ENABLED: "true",
				POX4_DECODER_ENABLED: "true",
				BNS_DECODER_ENABLED: "true",
				SBTC_SETTLEMENT_CONFIRMER_ENABLED: "true",
			}),
		).not.toContain(SETTLEMENT_CONFIRMER_NAME);
	});
});

type SeedRow = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: SbtcEventTopic;
	request_id?: number | null;
	sweep_txid?: string | null;
	canonical?: boolean;
};

function seed(row: SeedRow) {
	return {
		cursor: row.cursor,
		block_height: row.block_height,
		block_time: new Date("2026-05-01T00:00:00.000Z"),
		tx_id: row.tx_id,
		tx_index: row.tx_index,
		event_index: row.event_index,
		topic: row.topic,
		request_id: row.request_id ?? null,
		amount: null,
		sender: null,
		recipient_btc_version: null,
		recipient_btc_hashbytes: null,
		bitcoin_txid: null,
		output_index: null,
		sweep_txid: row.sweep_txid ?? null,
		burn_hash: null,
		burn_height: null,
		signer_bitmap: null,
		max_fee: null,
		fee: null,
		block_height_at_request: null,
		governance_contract_type: null,
		governance_new_contract: null,
		signer_aggregate_pubkey: null,
		signer_threshold: null,
		signer_address: null,
		signer_keys_count: null,
		canonical: row.canonical ?? true,
		source_cursor: row.cursor,
	};
}

/** A reader whose confirmation count is controlled by the test. */
function stubReader(confsRef: { value: number }) {
	return {
		async getConfirmations(txid: string): Promise<TxConfirmation> {
			const confs = confsRef.value;
			return {
				txid,
				found: true,
				confirmations: confs,
				blockHash: confs > 0 ? "0xblk" : null,
				blockHeight: confs > 0 ? 800_000 : null,
			};
		},
	};
}

describe.skipIf(!HAS_DB)("sBTC settlement confirmer (DB)", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM sbtc_settlements`.execute(db);
		await sql`DELETE FROM sbtc_events`.execute(db);
		await sql`DELETE FROM decoder_checkpoints WHERE decoder_name = ${SETTLEMENT_CONFIRMER_NAME}`.execute(
			db,
		);
	});

	test("readPendingSweeps returns only unconfirmed canonical accepts", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values([
				// eligible: canonical accept with a sweep
				seed({
					cursor: "100:0",
					block_height: 100,
					tx_id: "a1",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-accept",
					request_id: 1,
					sweep_txid: "0xsweep1",
				}),
				// excluded: non-canonical
				seed({
					cursor: "101:0",
					block_height: 101,
					tx_id: "a2",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-accept",
					request_id: 2,
					sweep_txid: "0xsweep2",
					canonical: false,
				}),
				// excluded: wrong topic
				seed({
					cursor: "102:0",
					block_height: 102,
					tx_id: "r1",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-reject",
					request_id: 3,
				}),
				// excluded: accept without a sweep_txid
				seed({
					cursor: "103:0",
					block_height: 103,
					tx_id: "a4",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-accept",
					request_id: 4,
					sweep_txid: null,
				}),
				// eligible-but-already-confirmed (settlements row below excludes it)
				seed({
					cursor: "104:0",
					block_height: 104,
					tx_id: "a5",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-accept",
					request_id: 5,
					sweep_txid: "0xsweep5",
				}),
			])
			.execute();
		await db
			.insertInto("sbtc_settlements")
			.values({
				sweep_txid: "0xsweep5",
				request_id: 5,
				// buried past the reorg-watch depth (>12) → settled for good, excluded
				btc_confirmations: 20,
				settlement_confirmed: true,
				block_hash: "0xblk",
				block_height: 800_000,
			})
			.execute();

		const pending = await readPendingSweeps({ db, limit: 100 });
		expect(pending).toEqual([{ sweep_txid: "0xsweep1", request_id: 1 }]);
	});

	test("drives a sweep 0 → 3 → 6 confirmations and confirms exactly once", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values(
				seed({
					cursor: "200:0",
					block_height: 200,
					tx_id: "acc",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-accept",
					request_id: 42,
					sweep_txid: "0xsweep42",
				}),
			)
			.execute();

		const confsRef = { value: 0 };
		const reader = stubReader(confsRef);

		async function readRow() {
			return db
				?.selectFrom("sbtc_settlements")
				.select([
					"btc_confirmations",
					"settlement_confirmed",
					"block_height",
					"confirmed_at",
				])
				.where("sweep_txid", "=", "0xsweep42")
				.executeTakeFirst();
		}

		// 0 confs → row created, unconfirmed
		await consumeSbtcSettlements({ db, reader });
		let row = await readRow();
		expect(row?.btc_confirmations).toBe(0);
		expect(row?.settlement_confirmed).toBe(false);
		expect(row?.confirmed_at).toBeNull();

		// 3 confs → count persists, still unconfirmed
		confsRef.value = 3;
		await consumeSbtcSettlements({ db, reader });
		row = await readRow();
		expect(row?.btc_confirmations).toBe(3);
		expect(row?.settlement_confirmed).toBe(false);
		expect(row?.confirmed_at).toBeNull();

		// 6 confs → flips confirmed, confirmed_at set, block height recorded
		confsRef.value = 6;
		await consumeSbtcSettlements({ db, reader });
		row = await readRow();
		expect(row?.btc_confirmations).toBe(6);
		expect(row?.settlement_confirmed).toBe(true);
		expect(row?.block_height).toBe(800_000);
		const confirmedAt = row?.confirmed_at;
		expect(confirmedAt).not.toBeNull();

		// confirmed at 6 but still within the reorg-watch window (< 12) → stays
		// queued for re-check; it only leaves once it buries past the watch depth.
		const stillPending = await readPendingSweeps({ db, limit: 100 });
		expect(stillPending).toEqual([{ sweep_txid: "0xsweep42", request_id: 42 }]);
	});

	test("health: healthy when caught up + fresh checkpoint, unhealthy when stale", async () => {
		if (!db) throw new Error("missing db");
		// No pending sweeps (backlog 0). A fresh checkpoint via a confirmer run.
		await consumeSbtcSettlements({ db, reader: stubReader({ value: 0 }) });

		const healthy = await getSettlementConfirmerHealth({ db });
		expect(healthy.decoder).toBe(SETTLEMENT_CONFIRMER_NAME);
		expect(healthy.status).toBe("healthy");

		// A checkpoint 10 minutes stale → unhealthy regardless of backlog.
		const stale = await getSettlementConfirmerHealth({
			db,
			now: new Date(Date.now() + 10 * 60_000),
		});
		expect(stale.status).toBe("unhealthy");
	});

	test("un-confirms a sweep when a Bitcoin reorg drops it below threshold", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values(
				seed({
					cursor: "300:0",
					block_height: 300,
					tx_id: "acc",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-accept",
					request_id: 7,
					sweep_txid: "0xsweep7",
				}),
			)
			.execute();

		const confsRef = { value: 6 };
		const reader = stubReader(confsRef);

		// Confirm at 6.
		await consumeSbtcSettlements({ db, reader });
		let row = await db
			.selectFrom("sbtc_settlements")
			.select(["settlement_confirmed", "btc_confirmations", "confirmed_at"])
			.where("sweep_txid", "=", "0xsweep7")
			.executeTakeFirst();
		expect(row?.settlement_confirmed).toBe(true);
		expect(row?.confirmed_at).not.toBeNull();
		// Still within the watch window → eligible for re-check.
		expect(await readPendingSweeps({ db, limit: 100 })).toEqual([
			{ sweep_txid: "0xsweep7", request_id: 7 },
		]);

		// Reorg drops it to 2 → un-confirm + clear confirmed_at.
		confsRef.value = 2;
		await consumeSbtcSettlements({ db, reader });
		row = await db
			.selectFrom("sbtc_settlements")
			.select(["settlement_confirmed", "btc_confirmations", "confirmed_at"])
			.where("sweep_txid", "=", "0xsweep7")
			.executeTakeFirst();
		expect(row?.settlement_confirmed).toBe(false);
		expect(row?.btc_confirmations).toBe(2);
		expect(row?.confirmed_at).toBeNull();
	});

	test("stops watching once a confirmed sweep buries past the reorg-watch depth", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values(
				seed({
					cursor: "400:0",
					block_height: 400,
					tx_id: "acc",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-accept",
					request_id: 8,
					sweep_txid: "0xsweep8",
				}),
			)
			.execute();

		const confsRef = { value: 6 };
		const reader = stubReader(confsRef);
		await consumeSbtcSettlements({ db, reader });
		expect(await readPendingSweeps({ db, limit: 100 })).toHaveLength(1);

		// Buries well past the default watch depth (12) → drops out of the queue.
		confsRef.value = 50;
		await consumeSbtcSettlements({ db, reader });
		const row = await db
			.selectFrom("sbtc_settlements")
			.select(["settlement_confirmed", "btc_confirmations"])
			.where("sweep_txid", "=", "0xsweep8")
			.executeTakeFirst();
		expect(row?.settlement_confirmed).toBe(true);
		expect(row?.btc_confirmations).toBe(50);
		expect(await readPendingSweeps({ db, limit: 100 })).toEqual([]);
	});

	test("deleteOrphanedSettlements removes settlements whose accept is gone", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values(
				seed({
					cursor: "500:0",
					block_height: 500,
					tx_id: "acc",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-accept",
					request_id: 9,
					sweep_txid: "0xkeep",
				}),
			)
			.execute();
		await db
			.insertInto("sbtc_settlements")
			.values([
				{ sweep_txid: "0xkeep", request_id: 9, btc_confirmations: 6 },
				// orphan: no backing canonical accept
				{ sweep_txid: "0xorphan", request_id: 99, btc_confirmations: 3 },
			])
			.execute();

		const deleted = await deleteOrphanedSettlements({ db });
		expect(deleted).toBe(1);
		const remaining = await db
			.selectFrom("sbtc_settlements")
			.select("sweep_txid")
			.execute();
		expect(remaining).toEqual([{ sweep_txid: "0xkeep" }]);
	});

	test("handleSbtcReorg cleans up settlements orphaned by the accept delete", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values(
				seed({
					cursor: "600:0",
					block_height: 600,
					tx_id: "acc",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-accept",
					request_id: 10,
					sweep_txid: "0xsweep10",
				}),
			)
			.execute();
		await db
			.insertInto("sbtc_settlements")
			.values({ sweep_txid: "0xsweep10", request_id: 10, btc_confirmations: 6 })
			.execute();

		// Reorg at/above 600 deletes the accept, orphaning its settlement.
		const result = await handleSbtcReorg(600, { db });
		expect(result.orphanedSettlements).toBe(1);
		const remaining = await db
			.selectFrom("sbtc_settlements")
			.select("sweep_txid")
			.execute();
		expect(remaining).toEqual([]);
	});
});
