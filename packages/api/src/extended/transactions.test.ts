import { describe, expect, test } from "bun:test";
import { createExtendedApp } from "./app.ts";
import type { ExtendedTx } from "./transactions.ts";

const DECODED_TX: ExtendedTx = {
	tx_id: "0xabc",
	tx_index: 0,
	tx_status: "success",
	tx_type: "token_transfer",
	sender_address: "SP1SENDER",
	block_height: 100,
	block_hash: "0xblock100",
	burn_block_time: 1_700_000_000,
	canonical: true,
	fee_rate: "180",
	nonce: 7,
	sponsored: false,
	anchor_mode: "any",
	post_condition_mode: "deny",
	token_transfer: {
		recipient: "SP1RECV",
		amount: "1000",
		memo: "",
	},
};

const COLUMNAR_ONLY: ExtendedTx = {
	tx_id: "0xnodecode",
	tx_index: 1,
	tx_status: "success",
	tx_type: "coinbase",
	sender_address: "",
	block_height: 100,
	block_hash: "0xblock100",
	burn_block_time: 1_700_000_000,
	canonical: true,
};

describe("extended transactions routes", () => {
	test("list envelope has no next_cursor", async () => {
		const app = createExtendedApp({
			listTransactions: async () => ({
				results: [DECODED_TX],
				total: 1,
			}),
		});
		const res = await app.request("/extended/v1/tx?limit=5&offset=0");
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual([
			"limit",
			"offset",
			"results",
			"total",
		]);
		expect("next_cursor" in body).toBe(false);
		expect("tip" in body).toBe(false);
		expect("reorgs" in body).toBe(false);
		expect(body.results).toEqual([DECODED_TX]);
	});

	test("decode-null still 200 with columnar fields", async () => {
		const app = createExtendedApp({
			getTransaction: async () => COLUMNAR_ONLY,
		});
		const res = await app.request("/extended/v1/tx/0xnodecode");
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.tx_id).toBe("0xnodecode");
		expect(body.tx_type).toBe("coinbase");
		expect(body.tx_status).toBe("success");
		expect(body.block_height).toBe(100);
		expect("fee_rate" in body).toBe(false);
		expect("nonce" in body).toBe(false);
		expect("post_conditions" in body).toBe(false);
	});

	test("unknown tx_id 404 Hiro-shaped", async () => {
		const app = createExtendedApp({
			getTransaction: async () => null,
		});
		const res = await app.request("/extended/v1/tx/0xmissing");
		expect(res.status).toBe(404);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ error: "Not found" });
		expect("code" in body).toBe(false);
	});

	test("from_cursor → 400", async () => {
		const app = createExtendedApp({
			listTransactions: async () => ({ results: [], total: 0 }),
		});
		const res = await app.request("/extended/v1/tx?from_cursor=1:0");
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBeTruthy();
	});

	test("passes from_height/to_height to list reader", async () => {
		let seen: { fromHeight?: number; toHeight?: number } | undefined;
		const app = createExtendedApp({
			listTransactions: async (q) => {
				seen = { fromHeight: q.fromHeight, toHeight: q.toHeight };
				return { results: [], total: 0 };
			},
		});
		const res = await app.request(
			"/extended/v1/tx?from_height=10&to_height=20",
		);
		expect(res.status).toBe(200);
		expect(seen).toEqual({ fromHeight: 10, toHeight: 20 });
	});
});
