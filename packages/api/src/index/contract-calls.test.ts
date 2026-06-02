import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";

// Hardcoded Clarity hex so this test needs no extra deps:
//   uint 100  → type byte 0x01 + 16-byte big-endian → cvToValue 100n → "100"
//   bool true → type byte 0x03 → cvToValue true
const HEX_UINT_100 = "0x0100000000000000000000000000000064";
const HEX_BOOL_TRUE = "0x03";
import {
	getContractCallsResponse,
	parseContractCallsQuery,
	readContractCalls,
} from "./contract-calls.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};

function params(query: string) {
	return new URL(`http://localhost/v1/index/contract-calls${query}`)
		.searchParams;
}

describe("Index /contract-calls query parsing", () => {
	test("defaults to last day when no explicit height or cursor", () => {
		const parsed = parseContractCallsQuery(params(""), TIP);
		expect(parsed.fromHeight).toBe(
			Math.max(0, TIP.block_height - STREAMS_BLOCKS_PER_DAY),
		);
	});

	test("parses block_height:tx_index cursor", () => {
		const parsed = parseContractCallsQuery(params("?from_cursor=9000:3"), TIP);
		expect(parsed.cursor).toEqual({ block_height: 9000, tx_index: 3 });
		expect(parsed.fromHeight).toBe(0);
	});

	test("rejects malformed cursor", () => {
		expect(() => parseContractCallsQuery(params("?cursor=abc"), TIP)).toThrow(
			"cursor must use <block_height>:<tx_index>",
		);
	});

	test("cursor and from_height are mutually exclusive", () => {
		expect(() =>
			parseContractCallsQuery(params("?cursor=9000:0&from_height=1"), TIP),
		).toThrow("mutually exclusive");
	});

	test("captures contract_id / function_name / sender filters", () => {
		const parsed = parseContractCallsQuery(
			params(
				"?from_height=0&contract_id=SP1.c&function_name=transfer&sender=SP2",
			),
			TIP,
		);
		expect(parsed.contractId).toBe("SP1.c");
		expect(parsed.functionName).toBe("transfer");
		expect(parsed.sender).toBe("SP2");
	});
});

describe("Index /contract-calls response", () => {
	test("always returns reorgs: [] and passes through calls", async () => {
		const response = await getContractCallsResponse({
			query: params("?from_height=0"),
			tip: TIP,
			readContractCalls: async () => ({
				contract_calls: [
					{
						cursor: "10:0",
						block_height: 10,
						tx_id: "0x01",
						tx_index: 0,
						contract_id: "SP1.c",
						function_name: "transfer",
						sender: "SP2",
						status: "success",
						args: ["100"],
						result: { ok: true },
						result_hex: "0x07",
					},
				],
				next_cursor: "10:0",
			}),
		});
		expect(response.reorgs).toEqual([]);
		expect(response.contract_calls.map((c) => c.cursor)).toEqual(["10:0"]);
		expect(response.next_cursor).toBe("10:0");
	});

	test("cursor past tip short-circuits without calling the reader", async () => {
		const response = await getContractCallsResponse({
			query: params(`?from_cursor=${TIP.block_height + 1}:0`),
			tip: TIP,
			readContractCalls: async () => {
				throw new Error("reader should not run past tip");
			},
		});
		expect(response.contract_calls).toEqual([]);
		expect(response.next_cursor).toBe(`${TIP.block_height + 1}:0`);
	});
});

describe.skipIf(!HAS_DB)("Index /contract-calls DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		// events.tx_id references transactions (no cascade); clear children first.
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	test("reads canonical contract_call txs and decodes args + result", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values({
				height: 9000,
				hash: "0xb9000",
				parent_hash: "0xb8999",
				burn_block_height: 1,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values({
				tx_id: "0xtx1",
				block_height: 9000,
				tx_index: 2,
				type: "contract_call",
				sender: "SP2",
				status: "success",
				contract_id: "SP1.token",
				function_name: "transfer",
				function_args: JSON.stringify([HEX_UINT_100]),
				raw_result: HEX_BOOL_TRUE,
				raw_tx: "0x00",
			})
			.execute();

		const result = await readContractCalls({
			db,
			fromHeight: 0,
			toHeight: 10_000,
			limit: 10,
		});
		expect(result.contract_calls).toHaveLength(1);
		expect(result.contract_calls[0]).toMatchObject({
			cursor: "9000:2",
			contract_id: "SP1.token",
			function_name: "transfer",
			sender: "SP2",
			args: ["100"],
			result: true,
		});
		expect(result.next_cursor).toBe("9000:2");
	});

	test("excludes txs whose block is non-canonical", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values({
				height: 9001,
				hash: "0xorphan",
				parent_hash: "0xb9000",
				burn_block_height: 1,
				timestamp: 1_700_000_001,
				canonical: false,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values({
				tx_id: "0xtx2",
				block_height: 9001,
				tx_index: 0,
				type: "contract_call",
				sender: "SP2",
				status: "success",
				contract_id: "SP1.token",
				function_name: "transfer",
				function_args: JSON.stringify([]),
				raw_result: null,
				raw_tx: "0x00",
			})
			.execute();

		const result = await readContractCalls({
			db,
			fromHeight: 0,
			toHeight: 10_000,
			limit: 10,
		});
		expect(result.contract_calls).toEqual([]);
	});
});
