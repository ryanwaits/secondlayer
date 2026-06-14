import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type { SbtcEventTopic } from "@secondlayer/shared/db";
import {
	type ReadSbtcEventsParams,
	type SbtcDepositsReader,
	type SbtcEventsReader,
	type SbtcWithdrawalsReader,
	getSbtcDepositsResponse,
	getSbtcEventsResponse,
	getSbtcWithdrawalsResponse,
	readSbtcDepositByBitcoinTxid,
	readSbtcDeposits,
	readSbtcEvents,
	readSbtcWithdrawalById,
	readSbtcWithdrawals,
} from "./sbtc-peg.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;

// finalized_height deliberately below block_height so `?confirmed=true` clamps.
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};

function eventsParams(query: string) {
	return new URL(`http://localhost/v1/index/sbtc/events${query}`).searchParams;
}

const EMPTY_EVENTS: SbtcEventsReader = async () => ({
	events: [],
	next_cursor: null,
});
const EMPTY_DEPOSITS: SbtcDepositsReader = async () => ({
	deposits: [],
	next_cursor: null,
});
const EMPTY_WITHDRAWALS: SbtcWithdrawalsReader = async () => ({
	withdrawals: [],
	next_cursor: null,
});

describe("sBTC peg helpers", () => {
	test("adds a notes hint when the sBTC decoder is disabled", async () => {
		const response = await getSbtcEventsResponse({
			query: eventsParams("?from_height=0"),
			tip: TIP,
			readSbtcEvents: EMPTY_EVENTS,
			decoderEnabled: false,
		});
		expect(response.events).toEqual([]);
		expect(response.notes).toContain("SBTC_DECODER_ENABLED");
	});

	test("omits notes when the decoder is enabled", async () => {
		const response = await getSbtcEventsResponse({
			query: eventsParams("?from_height=0"),
			tip: TIP,
			readSbtcEvents: EMPTY_EVENTS,
			decoderEnabled: true,
		});
		expect(response.notes).toBeUndefined();
	});

	test("a cursor past the tip returns empty and echoes the cursor", async () => {
		const response = await getSbtcEventsResponse({
			query: eventsParams("?from_cursor=40000:0"),
			tip: TIP,
			readSbtcEvents: EMPTY_EVENTS,
			decoderEnabled: true,
		});
		expect(response.events).toEqual([]);
		expect(response.next_cursor).toBe("40000:0");
	});

	test("rejects an unknown topic", async () => {
		await expect(
			getSbtcEventsResponse({
				query: eventsParams("?from_height=0&topic=bogus"),
				tip: TIP,
				readSbtcEvents: EMPTY_EVENTS,
			}),
		).rejects.toThrow(/unknown topic/);
	});

	test("rejects an unknown withdrawal status", async () => {
		await expect(
			getSbtcWithdrawalsResponse({
				query: eventsParams("?from_height=0&status=PENDING"),
				tip: TIP,
				readSbtcWithdrawals: EMPTY_WITHDRAWALS,
			}),
		).rejects.toThrow(/status must be one of/);
	});

	test("rejects a malformed confirmed value", async () => {
		await expect(
			getSbtcDepositsResponse({
				query: eventsParams("?from_height=0&confirmed=maybe"),
				tip: TIP,
				readSbtcDeposits: EMPTY_DEPOSITS,
			}),
		).rejects.toThrow(/confirmed must be/);
	});

	test("?confirmed=true clamps to_height to finalized_height", async () => {
		const seen: ReadSbtcEventsParams[] = [];
		await getSbtcEventsResponse({
			query: eventsParams("?from_height=0&confirmed=true"),
			tip: TIP,
			readSbtcEvents: async (params) => {
				seen.push(params);
				return { events: [], next_cursor: null };
			},
		});
		expect(seen[0]?.toHeight).toBe(TIP.finalized_height);
	});

	test("default to_height is the tip when not confirmed", async () => {
		const seen: ReadSbtcEventsParams[] = [];
		await getSbtcEventsResponse({
			query: eventsParams("?from_height=0"),
			tip: TIP,
			readSbtcEvents: async (params) => {
				seen.push(params);
				return { events: [], next_cursor: null };
			},
		});
		expect(seen[0]?.toHeight).toBe(TIP.block_height);
	});

	test("reorgs default to [] with no readReorgs wired", async () => {
		const response = await getSbtcEventsResponse({
			query: eventsParams("?from_height=0"),
			tip: TIP,
			readSbtcEvents: async () => ({
				events: [
					{
						cursor: "9000:0",
						block_height: 9000,
						event_index: 0,
						tx_id: "0x9000",
						tx_index: 0,
						topic: "completed-deposit",
						request_id: null,
						amount: "1000",
						sender: "SP1",
						recipient_btc_version: 1,
						recipient_btc_hashbytes: "0xab",
						bitcoin_txid: "0xbtc",
						output_index: 0,
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
					},
				],
				next_cursor: "9000:0",
			}),
			decoderEnabled: true,
		});
		expect(response.reorgs).toEqual([]);
		expect(response.events.map((e) => e.cursor)).toEqual(["9000:0"]);
	});

	test("queries readReorgs over the withdrawal create-event range", async () => {
		const seenRanges: Array<{ from: unknown; to: unknown }> = [];
		await getSbtcWithdrawalsResponse({
			query: eventsParams("?from_height=0"),
			tip: TIP,
			readSbtcWithdrawals: async () => ({
				withdrawals: [
					{
						cursor: "9000:2",
						request_id: 7,
						status: "ACCEPTED",
						amount: "500",
						sender: "SP1",
						recipient_btc_version: 1,
						recipient_btc_hashbytes: "0xab",
						sweep_txid: "0xsweep",
						requested_at: null,
						resolved_at: null,
					},
				],
				next_cursor: "9000:2",
			}),
			readReorgs: async (range) => {
				seenRanges.push(range);
				return [];
			},
		});
		expect(seenRanges[0]?.from).toEqual({ block_height: 9000, event_index: 2 });
	});
});

// --- DB-backed reads -------------------------------------------------------

type SeedRow = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: SbtcEventTopic;
	request_id?: number | null;
	amount?: string | null;
	sender?: string | null;
	bitcoin_txid?: string | null;
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
		amount: row.amount ?? null,
		sender: row.sender ?? null,
		recipient_btc_version: null,
		recipient_btc_hashbytes: null,
		bitcoin_txid: row.bitcoin_txid ?? null,
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

describe.skipIf(!HAS_DB)("sBTC peg DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM sbtc_events`.execute(db);
	});

	test("events: returns only canonical rows, ordered, across topics", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values([
				seed({
					cursor: "100:0",
					block_height: 100,
					tx_id: "0xa",
					tx_index: 0,
					event_index: 0,
					topic: "completed-deposit",
					bitcoin_txid: "0xbtc1",
				}),
				seed({
					cursor: "101:0",
					block_height: 101,
					tx_id: "0xb",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-create",
					request_id: 1,
				}),
				seed({
					cursor: "102:0",
					block_height: 102,
					tx_id: "0xc",
					tx_index: 0,
					event_index: 0,
					topic: "key-rotation",
					canonical: false,
				}),
			])
			.execute();

		const result = await readSbtcEvents({
			db,
			fromHeight: 0,
			toHeight: 200,
			limit: 50,
		});
		expect(result.events.map((e) => e.cursor)).toEqual(["100:0", "101:0"]);
		expect(result.events.map((e) => e.topic)).toEqual([
			"completed-deposit",
			"withdrawal-create",
		]);
	});

	test("deposits: only completed-deposit, filterable by bitcoin_txid", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values([
				seed({
					cursor: "100:0",
					block_height: 100,
					tx_id: "0xa",
					tx_index: 0,
					event_index: 0,
					topic: "completed-deposit",
					bitcoin_txid: "0xbtc1",
					amount: "1000",
				}),
				seed({
					cursor: "101:0",
					block_height: 101,
					tx_id: "0xb",
					tx_index: 0,
					event_index: 0,
					topic: "completed-deposit",
					bitcoin_txid: "0xbtc2",
				}),
				seed({
					cursor: "102:0",
					block_height: 102,
					tx_id: "0xc",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-create",
					request_id: 9,
				}),
			])
			.execute();

		const all = await readSbtcDeposits({
			db,
			fromHeight: 0,
			toHeight: 200,
			limit: 50,
		});
		expect(all.deposits.map((d) => d.bitcoin_txid)).toEqual([
			"0xbtc1",
			"0xbtc2",
		]);

		const filtered = await readSbtcDeposits({
			db,
			fromHeight: 0,
			toHeight: 200,
			limit: 50,
			bitcoinTxid: "0xbtc2",
		});
		expect(filtered.deposits.map((d) => d.cursor)).toEqual(["101:0"]);
	});

	test("withdrawals: one row per request_id with derived status + sweep_txid", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values([
				// request 1: created only → REQUESTED
				seed({
					cursor: "100:0",
					block_height: 100,
					tx_id: "0x1",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-create",
					request_id: 1,
					amount: "111",
				}),
				// request 2: created then accepted → ACCEPTED + sweep_txid
				seed({
					cursor: "101:0",
					block_height: 101,
					tx_id: "0x2",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-create",
					request_id: 2,
					amount: "222",
				}),
				seed({
					cursor: "105:0",
					block_height: 105,
					tx_id: "0x2b",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-accept",
					request_id: 2,
					sweep_txid: "0xsweep2",
				}),
				// request 3: created then rejected → REJECTED
				seed({
					cursor: "102:0",
					block_height: 102,
					tx_id: "0x3",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-create",
					request_id: 3,
					amount: "333",
				}),
				seed({
					cursor: "106:0",
					block_height: 106,
					tx_id: "0x3b",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-reject",
					request_id: 3,
				}),
			])
			.execute();

		const result = await readSbtcWithdrawals({
			db,
			fromHeight: 0,
			toHeight: 200,
			limit: 50,
		});
		// One row per request_id, ordered by the create-event cursor.
		expect(
			result.withdrawals.map((w) => [w.request_id, w.status, w.sweep_txid]),
		).toEqual([
			[1, "REQUESTED", null],
			[2, "ACCEPTED", "0xsweep2"],
			[3, "REJECTED", null],
		]);

		const accepted = await readSbtcWithdrawals({
			db,
			fromHeight: 0,
			toHeight: 200,
			limit: 50,
			status: "ACCEPTED",
		});
		expect(accepted.withdrawals.map((w) => w.request_id)).toEqual([2]);
	});

	test("withdrawal by id assembles the full lifecycle; null when absent", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values([
				seed({
					cursor: "100:0",
					block_height: 100,
					tx_id: "0xreq",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-create",
					request_id: 42,
					amount: "777",
					sender: "SP9",
				}),
				seed({
					cursor: "110:0",
					block_height: 110,
					tx_id: "0xacc",
					tx_index: 0,
					event_index: 0,
					topic: "withdrawal-accept",
					request_id: 42,
					sweep_txid: "0xsweep42",
				}),
			])
			.execute();

		const lifecycle = await readSbtcWithdrawalById(42, { db });
		expect(lifecycle?.status).toBe("ACCEPTED");
		expect(lifecycle?.requested.tx_id).toBe("0xreq");
		expect(lifecycle?.accepted?.sweep_txid).toBe("0xsweep42");
		expect(lifecycle?.rejected).toBeNull();
		expect(lifecycle?.settlement).toEqual({
			sweep_txid: "0xsweep42",
			btc_confirmations: null,
			settlement_confirmed: null,
		});
		expect(lifecycle?.latest_height).toBe(110);

		expect(await readSbtcWithdrawalById(999, { db })).toBeNull();
	});

	test("deposit by bitcoin_txid returns the typed object; null when absent", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("sbtc_events")
			.values([
				seed({
					cursor: "100:0",
					block_height: 100,
					tx_id: "0xa",
					tx_index: 0,
					event_index: 0,
					topic: "completed-deposit",
					bitcoin_txid: "0xbtcZ",
					amount: "1234",
				}),
			])
			.execute();

		const deposit = await readSbtcDepositByBitcoinTxid("0xbtcZ", { db });
		expect(deposit?.status).toBe("COMPLETED");
		expect(deposit?.amount).toBe("1234");
		expect(await readSbtcDepositByBitcoinTxid("0xnope", { db })).toBeNull();
	});
});
