import { describe, expect, mock, test } from "bun:test";
import {
	BTC_ADDRESS,
	btcBalance,
	btcBlockHeight,
	btcConfirmations,
	btcFeeEstimate,
	btcUtxos,
} from "../btc/index.ts";

function mockFetch(responses: Record<string, unknown>) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const restore = () => {
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		(globalThis as any).fetch = undefined;
	};
	// biome-ignore lint/suspicious/noExplicitAny: test mock
	(globalThis as any).fetch = mock(async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		const body = responses[url] ?? {};
		return new Response(JSON.stringify(body), {
			headers: { "content-type": "application/json" },
		});
	});
	return { calls, restore };
}

describe("BTC_ADDRESS schema", () => {
	const valid = [
		"1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
		"3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy",
		"bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
		"tb1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
	];
	const invalid = [
		"",
		"bad address",
		"../../../etc/passwd",
		"1A1z?foo=bar",
		"3J98t1&xss=true",
		"bc1<script>alert(1)</script>",
	];

	for (const addr of valid) {
		test(`accepts ${addr.slice(0, 10)}…`, () => {
			expect(() => BTC_ADDRESS.parse(addr)).not.toThrow();
		});
	}
	for (const addr of invalid) {
		test(`rejects ${addr || "(empty)"}`, () => {
			expect(() => BTC_ADDRESS.parse(addr)).toThrow();
		});
	}
});

describe("btcBalance", () => {
	test("returns confirmed and unconfirmed balance", async () => {
		const { calls, restore } = mockFetch({
			"https://mempool.space/api/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa": {
				chain_stats: { funded_txo_sum: 1000, spent_txo_sum: 0 },
				mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
			},
		});
		try {
			const result = await btcBalance.execute({
				address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
			});
			expect(result).toEqual({ confirmedSat: 1000, unconfirmedSat: 0 });
			expect(calls[0].url).toBe(
				"https://mempool.space/api/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
			);
		} finally {
			restore();
		}
	});

	test("URL-encodes malicious input when execute is called directly", async () => {
		const { calls, restore } = mockFetch({
			[`https://mempool.space/api/address/${encodeURIComponent("../../../etc/passwd?x=1")}`]:
				{
					chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
					mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
				},
		});
		try {
			await btcBalance.execute({
				address: "../../../etc/passwd?x=1",
			});
			expect(calls[0].url).toBe(
				`https://mempool.space/api/address/${encodeURIComponent("../../../etc/passwd?x=1")}`,
			);
			expect(calls[0].url).toContain("%2F");
		} finally {
			restore();
		}
	});
});

describe("btcUtxos", () => {
	test("returns sliced utxos", async () => {
		const { calls, restore } = mockFetch({
			"https://mempool.space/api/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa/utxo":
				[
					{
						txid: "abc",
						vout: 0,
						value: 100,
						status: { confirmed: true },
					},
					{
						txid: "def",
						vout: 1,
						value: 200,
						status: { confirmed: true },
					},
				],
		});
		try {
			const result = await btcUtxos.execute({
				address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
				limit: 1,
			});
			expect(result).toEqual({
				utxos: [
					{
						txid: "abc",
						vout: 0,
						value: 100,
						status: { confirmed: true },
					},
				],
			});
			expect(calls[0].url).toBe(
				"https://mempool.space/api/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa/utxo",
			);
		} finally {
			restore();
		}
	});

	test("URL-encodes malicious input when execute is called directly", async () => {
		const { calls, restore } = mockFetch({
			[`https://mempool.space/api/address/${encodeURIComponent("../admin?secret=1")}/utxo`]:
				[],
		});
		try {
			await btcUtxos.execute({
				address: "../admin?secret=1",
				limit: 10,
			});
			expect(calls[0].url).toBe(
				`https://mempool.space/api/address/${encodeURIComponent("../admin?secret=1")}/utxo`,
			);
			expect(calls[0].url).toContain("%3F");
		} finally {
			restore();
		}
	});
});

describe("btcConfirmations", () => {
	test("returns confirmed transaction with confirmations", async () => {
		const { restore } = mockFetch({
			"https://mempool.space/api/tx/1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef":
				{
					status: { confirmed: true, block_height: 100 },
				},
			"https://mempool.space/api/blocks/tip/height": 105,
		});
		try {
			const result = await btcConfirmations.execute({
				txid: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
			});
			expect(result).toEqual({
				confirmed: true,
				confirmations: 6,
				blockHeight: 100,
			});
		} finally {
			restore();
		}
	});

	test("returns unconfirmed transaction", async () => {
		const { restore } = mockFetch({
			"https://mempool.space/api/tx/1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef":
				{
					status: { confirmed: false },
				},
		});
		try {
			const result = await btcConfirmations.execute({
				txid: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
			});
			expect(result).toEqual({ confirmed: false, confirmations: 0 });
		} finally {
			restore();
		}
	});
});

describe("btcFeeEstimate", () => {
	test("returns fee estimates", async () => {
		const { restore } = mockFetch({
			"https://mempool.space/api/v1/fees/recommended": {
				fastestFee: 50,
				halfHourFee: 30,
				hourFee: 20,
				economyFee: 10,
				minimumFee: 5,
			},
		});
		try {
			const result = await btcFeeEstimate.execute({});
			expect(result).toEqual({
				fastestSatVb: 50,
				halfHourSatVb: 30,
				hourSatVb: 20,
				economySatVb: 10,
				minimumSatVb: 5,
			});
		} finally {
			restore();
		}
	});
});

describe("btcBlockHeight", () => {
	test("returns current height", async () => {
		const { restore } = mockFetch({
			"https://mempool.space/api/blocks/tip/height": 850000,
		});
		try {
			const result = await btcBlockHeight.execute({});
			expect(result).toEqual({ height: 850000 });
		} finally {
			restore();
		}
	});
});
