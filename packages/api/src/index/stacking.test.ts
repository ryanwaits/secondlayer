import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Pox4FunctionName } from "@secondlayer/shared/db/schema";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import {
	type StackingAction,
	type StackingReader,
	getStackingResponse,
	parseStackingQuery,
	readStacking,
} from "./stacking.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};

function params(query: string) {
	return new URL(`http://localhost/v1/index/stacking${query}`).searchParams;
}

const EMPTY_READER: StackingReader = async () => ({
	stacking: [],
	next_cursor: null,
});

describe("Index stacking helpers", () => {
	test("defaults to last day and parses filters", () => {
		const parsed = parseStackingQuery(
			params("?function_name=stack-stx&stacker=SP1&caller=SP2"),
			TIP,
		);
		expect(parsed.fromHeight).toBe(
			Math.max(0, TIP.block_height - STREAMS_BLOCKS_PER_DAY),
		);
		expect(parsed.functionName).toBe("stack-stx");
		expect(parsed.stacker).toBe("SP1");
		expect(parsed.caller).toBe("SP2");
	});

	test("adds a notes hint when the PoX-4 decoder is disabled", async () => {
		const response = await getStackingResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readStacking: EMPTY_READER,
			decoderEnabled: false,
		});
		expect(response.stacking).toEqual([]);
		expect(response.notes).toContain("POX4_DECODER_ENABLED");
	});

	test("omits notes when the decoder is enabled", async () => {
		const response = await getStackingResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readStacking: EMPTY_READER,
			decoderEnabled: true,
		});
		expect(response.notes).toBeUndefined();
	});

	test("a cursor past the tip returns empty and echoes the cursor", async () => {
		const response = await getStackingResponse({
			query: params("?from_cursor=40000:0"),
			tip: TIP,
			readStacking: EMPTY_READER,
			decoderEnabled: true,
		});
		expect(response.stacking).toEqual([]);
		expect(response.next_cursor).toBe("40000:0");
	});
});

describe("Index stacking reorgs", () => {
	const ROW: StackingAction = {
		cursor: "9000:0",
		block_height: 9000,
		burn_block_height: 19_000,
		tx_id: "0x9000",
		tx_index: 0,
		function_name: "stack-stx",
		caller: "SP1",
		stacker: "SP1",
		delegate_to: null,
		amount_ustx: "1000000",
		lock_period: 6,
		pox_addr: { version: 4, hashbytes: "0xabcd", btc: "bc1q9000" },
		start_cycle: 100,
		end_cycle: 106,
		reward_cycle: 100,
		signer_key: null,
		result_ok: true,
	};
	const ONE_ROW: StackingReader = async () => ({
		stacking: [ROW],
		next_cursor: "9000:0",
	});

	test("defaults reorgs to [] when no readReorgs is wired", async () => {
		const response = await getStackingResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readStacking: ONE_ROW,
			decoderEnabled: true,
		});
		expect(response.reorgs).toEqual([]);
		expect(response.stacking.map((s) => s.cursor)).toEqual(["9000:0"]);
	});

	test("queries readReorgs over the returned height range and passes through", async () => {
		const reorg = {
			detected_at: "2026-01-01T00:00:00.000Z",
			fork_point_height: 8999,
			old_index_block_hash: "0xold",
			new_index_block_hash: "0xnew",
			orphaned_range: { from: 9000, to: 9000 },
			new_canonical_tip: 9001,
		};
		const seenRanges: Array<{ fromHeight: number; toHeight: number }> = [];
		const response = await getStackingResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readStacking: ONE_ROW,
			readReorgs: async (range) => {
				seenRanges.push(range);
				return [reorg as never];
			},
			decoderEnabled: true,
		});
		expect(seenRanges[0]).toEqual({ fromHeight: 9000, toHeight: 9000 });
		expect(response.reorgs).toEqual([reorg as never]);
	});

	test("skips the reorg lookup on an empty page", async () => {
		let called = false;
		const response = await getStackingResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readStacking: EMPTY_READER,
			readReorgs: async () => {
				called = true;
				return [];
			},
			decoderEnabled: true,
		});
		expect(called).toBe(false);
		expect(response.reorgs).toEqual([]);
	});
});

describe.skipIf(!HAS_DB)("Index stacking DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM pox4_calls`.execute(db);
	});

	test("returns only canonical stacking actions, ordered, with pox_addr", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("pox4_calls")
			.values([
				call("9000:0", 9000, 0, "stack-stx", "SP1", true),
				call("9001:0", 9001, 0, "delegate-stx", "SP2", false),
				call("9002:0", 9002, 0, "stack-stx", "SP1", true),
			])
			.execute();

		const result = await readStacking({
			db,
			fromHeight: 0,
			toHeight: 10_000,
			limit: 10,
		});

		expect(result.stacking.map((s) => s.block_height)).toEqual([9000, 9002]);
		expect(result.stacking[0]).toMatchObject({
			cursor: "9000:0",
			function_name: "stack-stx",
			stacker: "SP1",
		});
		expect(result.stacking[0]?.pox_addr.btc).toBe("bc1q9000");
		expect(result.next_cursor).toBe("9002:0");
	});

	test("filters by function_name", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("pox4_calls")
			.values([
				call("9000:0", 9000, 0, "stack-stx", "SP1", true),
				call("9001:0", 9001, 0, "delegate-stx", "SP2", true),
			])
			.execute();

		const result = await readStacking({
			db,
			fromHeight: 0,
			toHeight: 10_000,
			functionName: "delegate-stx",
			limit: 10,
		});
		expect(result.stacking.map((s) => s.function_name)).toEqual([
			"delegate-stx",
		]);
	});
});

function call(
	cursor: string,
	blockHeight: number,
	txIndex: number,
	functionName: Pox4FunctionName,
	stacker: string,
	canonical: boolean,
) {
	return {
		cursor,
		block_height: blockHeight,
		block_time: new Date(1_700_000_000_000),
		burn_block_height: blockHeight + 10_000,
		tx_id: `0x${cursor}`,
		tx_index: txIndex,
		function_name: functionName,
		caller: stacker,
		stacker,
		delegate_to: null,
		amount_ustx: "1000000",
		lock_period: 6,
		pox_addr_version: 4,
		pox_addr_hashbytes: "0xabcd",
		pox_addr_btc: `bc1q${blockHeight}`,
		start_cycle: 100,
		end_cycle: 106,
		signer_key: null,
		signer_signature: null,
		auth_id: null,
		max_amount: null,
		reward_cycle: 100,
		aggregated_amount_ustx: null,
		aggregated_signer_index: null,
		auth_period: null,
		auth_topic: null,
		auth_allowed: null,
		result_ok: true,
		result_raw: "0x07",
		canonical,
		source_cursor: cursor,
	};
}
