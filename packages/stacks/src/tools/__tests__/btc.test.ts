import { describe, expect, mock, test } from "bun:test";
import { BTC_ADDRESS, btcBalance, btcUtxos } from "../btc/index.ts";

function mockFetch() {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const restore = () => {
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		(globalThis as any).fetch = undefined;
	};
	// biome-ignore lint/suspicious/noExplicitAny: test mock
	(globalThis as any).fetch = mock(async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		if (url.includes("/api/address/") && !url.endsWith("/utxo")) {
			return new Response(
				JSON.stringify({
					chain_stats: { funded_txo_sum: 1000, spent_txo_sum: 0 },
					mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
				}),
				{ headers: { "content-type": "application/json" } },
			);
		}
		if (url.endsWith("/utxo")) {
			return new Response(JSON.stringify([]), {
				headers: { "content-type": "application/json" },
			});
		}
		return new Response("{}", {
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
	test("URL-encodes the address", async () => {
		const { calls, restore } = mockFetch();
		try {
			await btcBalance.execute({
				address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
			});
			expect(calls[0].url).toBe(
				"https://mempool.space/api/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
			);
		} finally {
			restore();
		}
	});

	test("URL-encodes malicious input when execute is called directly", async () => {
		const { calls, restore } = mockFetch();
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
	test("URL-encodes the address", async () => {
		const { calls, restore } = mockFetch();
		try {
			await btcUtxos.execute({
				address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
				limit: 10,
			});
			expect(calls[0].url).toBe(
				"https://mempool.space/api/address/bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq/utxo",
			);
		} finally {
			restore();
		}
	});

	test("URL-encodes malicious input when execute is called directly", async () => {
		const { calls, restore } = mockFetch();
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
