import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	type MempoolReader,
	getMempoolResponse,
	parseMempoolQuery,
	readMempool,
	readMempoolByTxId,
} from "./mempool.ts";
import type { IndexTip } from "./tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 3,
};

// Real mainnet token transfer (decodes to fee 180 / nonce 2340924).
const TOKEN_TRANSFER_RAW =
	"0x00000000010400f2bba6df751755ab9ac1df8b387d981cfe265cdf000000000023b83c00000000000000b4000105c7d1e497ff1e980f6504947cd9f079f793041009c69179357883ec13c2b7661e541151591a4ededf6b0801d1a01ee32333420459d6029788001ceded4c5164030200000000000516fbd9a1702f4ecc44fc01f1894c72fcbb23a53ce8000000000000000100000000000000000000000000000000000000000000000000000000000000000000";

function params(query: string) {
	return new URL(`http://localhost/v1/index/mempool${query}`).searchParams;
}

const EMPTY_READER: MempoolReader = async () => ({
	mempool: [],
	next_cursor: null,
});

describe("Index mempool helpers", () => {
	test("parses cursor, sender, and type", () => {
		const parsed = parseMempoolQuery(
			params("?from_cursor=42&sender=SP1&type=contract_call"),
		);
		expect(parsed.after).toBe(42);
		expect(parsed.sender).toBe("SP1");
		expect(parsed.type).toBe("contract_call");
	});

	test("parses the contract_id filter", () => {
		const parsed = parseMempoolQuery(params("?contract_id=SP2.amm"));
		expect(parsed.contractId).toBe("SP2.amm");
	});

	test("rejects a non-integer cursor", () => {
		expect(() => parseMempoolQuery(params("?cursor=9000:0"))).toThrow();
	});

	test("forwards filters to the reader and includes the tip", async () => {
		const seen: Array<{ sender?: string }> = [];
		const response = await getMempoolResponse({
			query: params("?sender=SP1"),
			tip: TIP,
			readMempool: async (p) => {
				seen.push({ sender: p.sender });
				return { mempool: [], next_cursor: null };
			},
		});
		expect(seen[0]?.sender).toBe("SP1");
		expect(response.tip.block_height).toBe(30_000);
	});

	test("empty mempool yields a null cursor", async () => {
		const response = await getMempoolResponse({
			query: params(""),
			tip: TIP,
			readMempool: EMPTY_READER,
		});
		expect(response.mempool).toEqual([]);
		expect(response.next_cursor).toBeNull();
	});
});

describe.skipIf(!HAS_DB)("Index mempool DB reads", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM mempool_transactions`.execute(db);
	});

	async function seed() {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("mempool_transactions")
			.values([
				{
					tx_id: "0xtt",
					raw_tx: TOKEN_TRANSFER_RAW,
					type: "token_transfer",
					sender: "SP3SBQ9PZEMBNBAWTR7FRPE3XK0EFW9JWVX4G80S2",
					contract_id: null,
					function_name: null,
					function_args: null,
				},
				{
					tx_id: "0xcc",
					raw_tx: "0x00",
					type: "contract_call",
					sender: "SP2",
					contract_id: "SP2.amm",
					function_name: "swap",
					function_args: null,
				},
			])
			.execute();
	}

	test("returns pending txs ordered by seq, merging decoded enrichment", async () => {
		await seed();
		const result = await readMempool({ db: db ?? undefined, limit: 10 });
		expect(result.mempool.map((t) => t.tx_id)).toEqual(["0xtt", "0xcc"]);

		const transfer = result.mempool[0];
		expect(transfer?.tx_type).toBe("token_transfer");
		expect(transfer?.fee).toBe("180");
		expect(transfer?.received_at).not.toBeNull();

		const call = result.mempool[1];
		// raw_tx "0x00" is undecodable → enrichment null, columnar detail stays.
		expect(call?.fee).toBeNull();
		expect(call?.contract_call?.function_name).toBe("swap");
		expect(result.next_cursor).toBe(result.mempool[1]?.cursor);
	});

	test("filters by type and paginates by seq cursor", async () => {
		await seed();
		const filtered = await readMempool({
			db: db ?? undefined,
			type: "contract_call",
			limit: 10,
		});
		expect(filtered.mempool.map((t) => t.tx_id)).toEqual(["0xcc"]);

		const firstSeq = Number(filtered.mempool[0]?.cursor);
		const after = await readMempool({
			db: db ?? undefined,
			after: firstSeq,
			limit: 10,
		});
		expect(after.mempool.some((t) => t.tx_id === "0xcc")).toBe(false);
	});

	test("filters by contract_id", async () => {
		await seed();
		const filtered = await readMempool({
			db: db ?? undefined,
			contractId: "SP2.amm",
			limit: 10,
		});
		expect(filtered.mempool.map((t) => t.tx_id)).toEqual(["0xcc"]);
	});

	test("fetches a single pending tx by tx_id", async () => {
		await seed();
		const found = await readMempoolByTxId("0xtt", db ?? undefined);
		expect(found?.tx_type).toBe("token_transfer");
		expect(await readMempoolByTxId("0xnope", db ?? undefined)).toBeNull();
	});
});
