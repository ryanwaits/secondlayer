import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import type { IndexTip } from "./tip.ts";
import {
	type TransactionsReader,
	getTransactionsResponse,
	parseTransactionsQuery,
	readTransactionById,
	readTransactions,
} from "./transactions.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};

// Real mainnet transactions (shared with the decoder + indexer parser tests).
const TOKEN_TRANSFER_RAW =
	"0x00000000010400f2bba6df751755ab9ac1df8b387d981cfe265cdf000000000023b83c00000000000000b4000105c7d1e497ff1e980f6504947cd9f079f793041009c69179357883ec13c2b7661e541151591a4ededf6b0801d1a01ee32333420459d6029788001ceded4c5164030200000000000516fbd9a1702f4ecc44fc01f1894c72fcbb23a53ce8000000000000000100000000000000000000000000000000000000000000000000000000000000000000";

function params(query: string) {
	return new URL(`http://localhost/v1/index/transactions${query}`).searchParams;
}

const EMPTY_READER: TransactionsReader = async () => ({
	transactions: [],
	next_cursor: null,
});

describe("Index transactions helpers", () => {
	test("defaults to last day when no explicit height or cursor is provided", () => {
		const parsed = parseTransactionsQuery(params(""), TIP);
		expect(parsed.fromHeight).toBe(
			Math.max(0, TIP.block_height - STREAMS_BLOCKS_PER_DAY),
		);
	});

	test("parses type, sender, and contract_id filters", () => {
		const parsed = parseTransactionsQuery(
			params("?type=contract_call&sender=SP1&contract_id=SP2.amm"),
			TIP,
		);
		expect(parsed.type).toBe("contract_call");
		expect(parsed.sender).toBe("SP1");
		expect(parsed.contractId).toBe("SP2.amm");
	});

	test("cursor uses block_height:tx_index", () => {
		const parsed = parseTransactionsQuery(params("?from_cursor=9000:3"), TIP);
		expect(parsed.cursor).toEqual({ block_height: 9000, tx_index: 3 });
	});

	test("forwards filters to the reader and always returns reorgs []", async () => {
		const seen: Array<{ type?: string }> = [];
		const response = await getTransactionsResponse({
			query: params("?type=token_transfer"),
			tip: TIP,
			readTransactions: async (p) => {
				seen.push({ type: p.type });
				return { transactions: [], next_cursor: null };
			},
		});
		expect(seen[0]?.type).toBe("token_transfer");
		expect(response.reorgs).toEqual([]);
	});

	test("a cursor past the tip returns empty and echoes the cursor", async () => {
		const response = await getTransactionsResponse({
			query: params("?from_cursor=40000:0"),
			tip: TIP,
			readTransactions: EMPTY_READER,
		});
		expect(response.transactions).toEqual([]);
		expect(response.next_cursor).toBe("40000:0");
	});
});

describe.skipIf(!HAS_DB)("Index transactions DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	async function seed() {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values([
				{
					height: 9000,
					hash: "0x9000",
					parent_hash: "0x8999",
					burn_block_height: 19_000,
					burn_block_hash: "0xb9000",
					timestamp: 1_700_000_000,
					canonical: true,
				},
			])
			.execute();
		await db
			.insertInto("transactions")
			.values([
				{
					tx_id: "0xtt",
					block_height: 9000,
					tx_index: 0,
					type: "token_transfer",
					sender: "SP1",
					status: "success",
					contract_id: null,
					function_name: null,
					function_args: null,
					raw_result: null,
					raw_tx: TOKEN_TRANSFER_RAW,
				},
				{
					tx_id: "0xcc",
					block_height: 9000,
					tx_index: 1,
					type: "contract_call",
					sender: "SP2",
					status: "success",
					contract_id: "SP2.amm",
					function_name: "swap",
					function_args: null,
					raw_result: null,
					raw_tx: "0x00",
				},
			])
			.execute();
	}

	test("returns the full document, merging decoded enrichment", async () => {
		await seed();
		const result = await readTransactions({
			db: db ?? undefined,
			fromHeight: 0,
			toHeight: 10_000,
			limit: 10,
		});

		expect(result.transactions.map((t) => t.tx_id)).toEqual(["0xtt", "0xcc"]);
		const transfer = result.transactions[0];
		expect(transfer?.tx_type).toBe("token_transfer");
		expect(transfer?.fee).toBe("180");
		expect(transfer?.token_transfer?.amount).toBe("1");

		const call = result.transactions[1];
		// raw_tx "0x00" is undecodable → enrichment is null, columnar detail stays.
		expect(call?.tx_type).toBe("contract_call");
		expect(call?.fee).toBeNull();
		expect(call?.contract_call?.contract_id).toBe("SP2.amm");
		expect(call?.contract_call?.function_name).toBe("swap");
		expect(result.next_cursor).toBe("9000:1");
	});

	test("filters by type", async () => {
		await seed();
		const result = await readTransactions({
			db: db ?? undefined,
			fromHeight: 0,
			toHeight: 10_000,
			type: "token_transfer",
			limit: 10,
		});
		expect(result.transactions.map((t) => t.tx_id)).toEqual(["0xtt"]);
	});

	test("fetches a single transaction by tx_id", async () => {
		await seed();
		const found = await readTransactionById("0xtt", db ?? undefined);
		expect(found?.tx_type).toBe("token_transfer");
		const missing = await readTransactionById("0xnope", db ?? undefined);
		expect(missing).toBeNull();
	});

	test("excludes transactions at a non-canonical height", async () => {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values([
				{
					height: 9001,
					hash: "0x9001",
					parent_hash: "0x9000",
					burn_block_height: 19_001,
					burn_block_hash: "0xb9001",
					timestamp: 1_700_000_001,
					canonical: false,
				},
			])
			.execute();
		await db
			.insertInto("transactions")
			.values([
				{
					tx_id: "0xorphan",
					block_height: 9001,
					tx_index: 0,
					type: "token_transfer",
					sender: "SP1",
					status: "success",
					contract_id: null,
					function_name: null,
					function_args: null,
					raw_result: null,
					raw_tx: TOKEN_TRANSFER_RAW,
				},
			])
			.execute();

		const result = await readTransactions({
			db: db ?? undefined,
			fromHeight: 0,
			toHeight: 10_000,
			limit: 10,
		});
		expect(result.transactions).toEqual([]);
	});
});
