import { describe, expect, test } from "bun:test";
import { createExtendedApp } from "./app.ts";
import type { ExtendedTx } from "./transactions.ts";
import type { ExtendedNftTransfer } from "./transfers.ts";

// Skipped Hiro paths (ext-003): /extended/v1/address/:principal/balances,
// /extended/v1/address/:principal/assets, /extended/v1/address/:principal/stx,
// /extended/v1/tokens/nft/mints, /extended/v1/tokens/ft/.../transfers,
// /extended/v1/names (BNS → ext-004), mempool.

const TX: ExtendedTx = {
	tx_id: "0xabc",
	tx_index: 0,
	tx_status: "success",
	tx_type: "token_transfer",
	sender_address: "SP1SENDER",
	block_height: 100,
};

const NFT: ExtendedNftTransfer = {
	sender: "SP1SENDER",
	recipient: "SP1RECV",
	asset_identifier: "SP1.nft::NFT",
	value: "1",
	tx_id: "0xabc",
	block_height: 100,
	event_index: 0,
	asset_event_type: "transfer",
};

describe("extended address transactions", () => {
	test("envelope keys exactly limit|offset|total|results", async () => {
		let seenSender: string | undefined;
		const app = createExtendedApp({
			listTransactions: async (q) => {
				seenSender = q.sender;
				return { results: [TX], total: 1 };
			},
		});
		const res = await app.request(
			"/extended/v1/address/SP1SENDER/transactions?limit=10&offset=0",
		);
		expect(res.status).toBe(200);
		expect(seenSender).toBe("SP1SENDER");
		const body = (await res.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual([
			"limit",
			"offset",
			"results",
			"total",
		]);
		expect(body.results).toEqual([TX]);
		expect("next_cursor" in body).toBe(false);
		expect("tip" in body).toBe(false);
		expect("reorgs" in body).toBe(false);
	});

	test("unknown principal → total 0 results []", async () => {
		const app = createExtendedApp({
			listTransactions: async (q) => {
				expect(q.sender).toBe("SPUNKNOWN");
				return { results: [], total: 0 };
			},
		});
		const res = await app.request(
			"/extended/v1/address/SPUNKNOWN/transactions",
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			total: number;
			results: unknown[];
		};
		expect(body.total).toBe(0);
		expect(body.results).toEqual([]);
	});
});

describe("extended nft transfers", () => {
	test("list envelope has no next_cursor", async () => {
		const app = createExtendedApp({
			listNftTransfers: async () => ({ results: [NFT], total: 1 }),
		});
		const res = await app.request("/extended/v1/tokens/nft/transfers");
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
		expect(body.results).toEqual([NFT]);
	});

	test("passes asset_identifier filter", async () => {
		let seen: string | undefined;
		const app = createExtendedApp({
			listNftTransfers: async (q) => {
				seen = q.assetIdentifier;
				return { results: [], total: 0 };
			},
		});
		const res = await app.request(
			"/extended/v1/tokens/nft/transfers?asset_identifier=SP1.nft%3A%3ANFT",
		);
		expect(res.status).toBe(200);
		expect(seen).toBe("SP1.nft::NFT");
	});

	test("cursor query param → 400", async () => {
		const app = createExtendedApp({
			listNftTransfers: async () => ({ results: [], total: 0 }),
		});
		const res = await app.request(
			"/extended/v1/tokens/nft/transfers?cursor=1:0",
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.error).toBeTruthy();
		expect("code" in body).toBe(false);
	});

	test("accepts limit 50", async () => {
		let seenLimit: number | undefined;
		const app = createExtendedApp({
			listNftTransfers: async (q) => {
				seenLimit = q.limit;
				return { results: [], total: 0 };
			},
		});
		const res = await app.request("/extended/v1/tokens/nft/transfers?limit=50");
		expect(res.status).toBe(200);
		expect(seenLimit).toBe(50);
	});

	test("limit 51 → 400", async () => {
		const app = createExtendedApp({
			listNftTransfers: async () => ({ results: [], total: 0 }),
		});
		const res = await app.request("/extended/v1/tokens/nft/transfers?limit=51");
		expect(res.status).toBe(400);
	});
});
