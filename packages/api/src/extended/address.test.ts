import { describe, expect, test } from "bun:test";
import {
	type ExtendedFtHolding,
	type ExtendedNftHolding,
	type ExtendedStxTotals,
	netFt,
	netNft,
	netStx,
	projectStxLock,
} from "./address.ts";
import { createExtendedApp } from "./app.ts";

const PRINCIPAL = "SP1OWNER";

describe("netStx", () => {
	test("receive 100 send 40 → balance 60; amounts are strings", () => {
		const out = netStx(
			[
				{
					event_type: "stx_transfer",
					sender: "SPOTHER",
					recipient: PRINCIPAL,
					amount: "100",
				},
				{
					event_type: "stx_transfer",
					sender: PRINCIPAL,
					recipient: "SPOTHER",
					amount: "40",
				},
			],
			PRINCIPAL,
		);
		expect(out).toEqual({
			balance: "60",
			total_sent: "40",
			total_received: "100",
		});
		expect(typeof out.balance).toBe("string");
		expect(typeof out.total_sent).toBe("string");
		expect(typeof out.total_received).toBe("string");
	});

	test("mints count as received; burns count as sent", () => {
		const out = netStx(
			[
				{
					event_type: "stx_mint",
					sender: null,
					recipient: PRINCIPAL,
					amount: "50",
				},
				{
					event_type: "stx_burn",
					sender: PRINCIPAL,
					recipient: null,
					amount: "10",
				},
			],
			PRINCIPAL,
		);
		expect(out).toEqual({
			balance: "40",
			total_sent: "10",
			total_received: "50",
		});
	});

	test("invalid amounts skipped", () => {
		const out = netStx(
			[
				{
					event_type: "stx_transfer",
					sender: "SPOTHER",
					recipient: PRINCIPAL,
					amount: "100",
				},
				{
					event_type: "stx_transfer",
					sender: "SPOTHER",
					recipient: PRINCIPAL,
					amount: "1.5",
				},
				{
					event_type: "stx_transfer",
					sender: "SPOTHER",
					recipient: PRINCIPAL,
					amount: "nope",
				},
			],
			PRINCIPAL,
		);
		expect(out.total_received).toBe("100");
	});

	test("empty rows → zeros", () => {
		expect(netStx([], PRINCIPAL)).toEqual({
			balance: "0",
			total_sent: "0",
			total_received: "0",
		});
	});
});

describe("projectStxLock", () => {
	test("no lock row → empty object", () => {
		expect(projectStxLock(null)).toEqual({});
		expect(projectStxLock(undefined)).toEqual({});
	});

	test("lock payload round-trips unlock_height", () => {
		expect(
			projectStxLock({
				amount: "500",
				tx_id: "0xlock",
				block_height: 100,
				event_index: 0,
				payload: { unlock_height: 200 },
			}),
		).toEqual({
			locked: "500",
			lock_tx_id: "0xlock",
			unlock_height: 200,
		});
	});
});

describe("netFt", () => {
	test("one FT in + one FT out → net", () => {
		const asset = "SP1.token::TOKEN";
		const out = netFt(
			[
				{
					event_type: "ft_transfer",
					asset_identifier: asset,
					sender: "SPOTHER",
					recipient: PRINCIPAL,
					amount: "100",
				},
				{
					event_type: "ft_transfer",
					asset_identifier: asset,
					sender: PRINCIPAL,
					recipient: "SPOTHER",
					amount: "40",
				},
			],
			PRINCIPAL,
		);
		expect(out).toEqual([{ asset_identifier: asset, balance: "60" }]);
	});

	test("net zero dropped", () => {
		const asset = "SP1.token::TOKEN";
		const out = netFt(
			[
				{
					event_type: "ft_mint",
					asset_identifier: asset,
					sender: null,
					recipient: PRINCIPAL,
					amount: "10",
				},
				{
					event_type: "ft_burn",
					asset_identifier: asset,
					sender: PRINCIPAL,
					recipient: null,
					amount: "10",
				},
			],
			PRINCIPAL,
		);
		expect(out).toEqual([]);
	});
});

describe("netNft", () => {
	test("NFT transferred away disappears", () => {
		const asset = "SP1.nft::NFT";
		const out = netNft(
			[
				{
					event_type: "nft_mint",
					asset_identifier: asset,
					value: "1",
					sender: null,
					recipient: PRINCIPAL,
				},
				{
					event_type: "nft_transfer",
					asset_identifier: asset,
					value: "1",
					sender: PRINCIPAL,
					recipient: "SPOTHER",
				},
			],
			PRINCIPAL,
		);
		expect(out).toEqual([]);
	});

	test("mint retained", () => {
		const asset = "SP1.nft::NFT";
		const out = netNft(
			[
				{
					event_type: "nft_mint",
					asset_identifier: asset,
					value: "7",
					sender: null,
					recipient: PRINCIPAL,
				},
			],
			PRINCIPAL,
		);
		expect(out).toEqual([{ asset_identifier: asset, value: "7" }]);
	});
});

describe("extended address routes", () => {
	test("stx: receive/send strings; no fee key; no nonce", async () => {
		const totals: ExtendedStxTotals = {
			balance: "60",
			total_sent: "40",
			total_received: "100",
		};
		const app = createExtendedApp({
			getStx: async () => totals,
		});
		const res = await app.request(`/extended/v1/address/${PRINCIPAL}/stx`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.balance).toBe("60");
		expect(body.total_sent).toBe("40");
		expect(body.total_received).toBe("100");
		expect("total_fees_sent" in body).toBe(false);
		expect("nonce" in body).toBe(false);
		expect("locked" in body).toBe(false);
		expect("lock_tx_id" in body).toBe(false);
		expect("unlock_height" in body).toBe(false);
	});

	test("stx: lock fields when lock row present", async () => {
		const app = createExtendedApp({
			getStx: async () => ({
				balance: "0",
				total_sent: "0",
				total_received: "0",
				locked: "500",
				lock_tx_id: "0xlock",
				unlock_height: 200,
			}),
		});
		const res = await app.request(`/extended/v1/address/${PRINCIPAL}/stx`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.locked).toBe("500");
		expect(body.lock_tx_id).toBe("0xlock");
		expect(body.unlock_height).toBe(200);
	});

	test("stx empty principal still 200 with zeros", async () => {
		const app = createExtendedApp({
			getStx: async () => ({
				balance: "0",
				total_sent: "0",
				total_received: "0",
			}),
		});
		const res = await app.request("/extended/v1/address/SPUNKNOWN/stx");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			balance: "0",
			total_sent: "0",
			total_received: "0",
		});
	});

	test("ft list envelope", async () => {
		const holdings: ExtendedFtHolding[] = [
			{ asset_identifier: "SP1.token::TOKEN", balance: "60" },
		];
		let seen: string | undefined;
		const app = createExtendedApp({
			listFt: async (q) => {
				seen = q.principal;
				return { results: holdings, total: 1 };
			},
		});
		const res = await app.request(
			`/extended/v1/address/${PRINCIPAL}/ft?limit=10&offset=0`,
		);
		expect(res.status).toBe(200);
		expect(seen).toBe(PRINCIPAL);
		const body = (await res.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual([
			"limit",
			"offset",
			"results",
			"total",
		]);
		expect(body.results).toEqual(holdings);
	});

	test("ft empty principal → empty results", async () => {
		const app = createExtendedApp({
			listFt: async () => ({ results: [], total: 0 }),
		});
		const res = await app.request("/extended/v1/address/SPUNKNOWN/ft");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { total: number; results: unknown[] };
		expect(body.total).toBe(0);
		expect(body.results).toEqual([]);
	});

	test("nft list envelope", async () => {
		const holdings: ExtendedNftHolding[] = [
			{ asset_identifier: "SP1.nft::NFT", value: "7" },
		];
		const app = createExtendedApp({
			listNft: async () => ({ results: holdings, total: 1 }),
		});
		const res = await app.request(`/extended/v1/address/${PRINCIPAL}/nft`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual([
			"limit",
			"offset",
			"results",
			"total",
		]);
		expect(body.results).toEqual(holdings);
	});

	test("createApiApp 404s /extended address stx with v1 envelope", async () => {
		const { createApiApp } = await import("../create-app.ts");
		const app = createApiApp("oss");
		const res = await app.request("/extended/v1/address/SP1/stx");
		expect(res.status).toBe(404);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("NOT_FOUND");
	});
});
