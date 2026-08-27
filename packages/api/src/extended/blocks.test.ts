import { describe, expect, test } from "bun:test";
import { createExtendedApp } from "./app.ts";
import type { ExtendedBlock, ExtendedBlockListItem } from "./blocks.ts";

const LIST_ITEM: ExtendedBlockListItem = {
	canonical: true,
	height: 100,
	hash: "0xblock100",
	index_block_hash: "0xidx100",
	parent_block_hash: "0xblock99",
	parent_index_block_hash: "0xidx99",
	burn_block_hash: "0xburn",
	burn_block_height: 850_000,
	burn_block_time: 1_700_000_000,
	burn_block_time_iso: "2023-11-14T22:13:20.000Z",
};

const SINGLE: ExtendedBlock = {
	...LIST_ITEM,
	txs: ["0xtx0", "0xtx1"],
	tx_count: 2,
};

describe("extended blocks routes", () => {
	test("list envelope keys exactly limit|offset|total|results", async () => {
		const app = createExtendedApp({
			listBlocks: async () => ({ results: [LIST_ITEM], total: 1 }),
		});
		const res = await app.request("/extended/v1/block?limit=10&offset=0");
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual([
			"limit",
			"offset",
			"results",
			"total",
		]);
		expect(body.limit).toBe(10);
		expect(body.offset).toBe(0);
		expect(body.total).toBe(1);
		expect(body.results).toEqual([LIST_ITEM]);
		expect("next_cursor" in body).toBe(false);
		expect("tip" in body).toBe(false);
		expect("reorgs" in body).toBe(false);
	});

	test("list omits txs on each result", async () => {
		const app = createExtendedApp({
			listBlocks: async () => ({ results: [LIST_ITEM], total: 1 }),
		});
		const res = await app.request("/extended/v1/block");
		const body = (await res.json()) as {
			results: Array<Record<string, unknown>>;
		};
		expect(body.results.length).toBe(1);
		const first = body.results[0] as Record<string, unknown>;
		expect("txs" in first).toBe(false);
		expect("tx_count" in first).toBe(false);
	});

	test("single block has txs, no miner_txid or execution_cost_*", async () => {
		const app = createExtendedApp({
			getBlock: async (ref) => {
				expect(ref).toBe("0xblock100");
				return SINGLE;
			},
		});
		const res = await app.request("/extended/v1/block/0xblock100");
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.txs).toEqual(["0xtx0", "0xtx1"]);
		expect(body.tx_count).toBe(2);
		expect(body.parent_index_block_hash).toBe("0xidx99");
		expect("miner_txid" in body).toBe(false);
		expect("execution_cost_read_count" in body).toBe(false);
		expect("execution_cost_read_length" in body).toBe(false);
		expect("execution_cost_runtime" in body).toBe(false);
		expect("execution_cost_write_count" in body).toBe(false);
		expect("execution_cost_write_length" in body).toBe(false);
		expect("next_cursor" in body).toBe(false);
	});

	test("unknown block 404 Hiro-shaped", async () => {
		const app = createExtendedApp({
			getBlock: async () => null,
		});
		const res = await app.request("/extended/v1/block/0xmissing");
		expect(res.status).toBe(404);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ error: "Not found" });
		expect("code" in body).toBe(false);
	});

	test("cursor query param → 400", async () => {
		const app = createExtendedApp({
			listBlocks: async () => ({ results: [], total: 0 }),
		});
		const res = await app.request("/extended/v1/block?cursor=1:0");
		expect(res.status).toBe(400);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.error).toBeTruthy();
		expect("code" in body).toBe(false);
	});
});
