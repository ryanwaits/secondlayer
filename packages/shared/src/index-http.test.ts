import { afterEach, describe, expect, test } from "bun:test";
import { IndexHttpClient } from "./index-http.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function stubFetch(body: unknown): void {
	globalThis.fetch = (async () =>
		new Response(JSON.stringify(body), {
			status: 200,
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;
}

function client(): IndexHttpClient {
	return new IndexHttpClient({
		indexBaseUrl: "http://api.test",
		streamsBaseUrl: "http://api.test",
	});
}

describe("IndexHttpClient.getDecodedHeights", () => {
	test("undefined before any tip call", () => {
		expect(client().getDecodedHeights()).toBeUndefined();
	});

	test("reflects decoded_heights from the same envelope getIndexTip() just fetched", async () => {
		const http = client();
		stubFetch({
			blocks: [],
			next_cursor: null,
			tip: {
				block_height: 100,
				decoded_heights: { ft_transfer: 100, stx_transfer: 90, print: null },
			},
		});
		const tip = await http.getIndexTip();
		expect(tip).toBe(100);
		expect(http.getDecodedHeights()).toEqual({
			ft_transfer: 100,
			stx_transfer: 90,
			print: null,
		});
	});

	test("undefined against an older server that omits the field", async () => {
		const http = client();
		stubFetch({ blocks: [], next_cursor: null, tip: { block_height: 100 } });
		await http.getIndexTip();
		expect(http.getDecodedHeights()).toBeUndefined();
	});

	test("getIndexSourceTip() also populates it (same envelope)", async () => {
		const http = client();
		stubFetch({
			blocks: [],
			next_cursor: null,
			tip: {
				block_height: 100,
				source_block_height: 120,
				decoded_heights: { map_set: 120 },
			},
		});
		await http.getIndexSourceTip();
		expect(http.getDecodedHeights()).toEqual({ map_set: 120 });
	});
});

describe("IndexHttpClient.getIndexTip wait", () => {
	function stubFetchCapturingUrl(body: unknown): { urls: string[] } {
		const urls: string[] = [];
		globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
			urls.push(String(input));
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;
		return { urls };
	}

	test("omits wait/from_height when no opts are given (unchanged wire shape)", async () => {
		const { urls } = stubFetchCapturingUrl({
			blocks: [],
			next_cursor: null,
			tip: { block_height: 100 },
		});
		await client().getIndexTip();
		expect(urls).toEqual(["http://api.test/v1/index/blocks?limit=1"]);
	});

	test("sends wait + from_height (one past knownHeight) when both are passed", async () => {
		const { urls } = stubFetchCapturingUrl({
			blocks: [],
			next_cursor: null,
			tip: { block_height: 101 },
		});
		await client().getIndexTip({ wait: 10, knownHeight: 100 });
		const url = new URL(urls[0] ?? "");
		expect(url.searchParams.get("wait")).toBe("10");
		expect(url.searchParams.get("from_height")).toBe("101");
	});

	test("clamps wait to MAX_INDEX_WAIT_SECONDS", async () => {
		const { urls } = stubFetchCapturingUrl({
			blocks: [],
			next_cursor: null,
			tip: { block_height: 100 },
		});
		await client().getIndexTip({ wait: 999, knownHeight: 100 });
		const url = new URL(urls[0] ?? "");
		expect(url.searchParams.get("wait")).toBe("25");
	});

	test("a 400 (older server rejects wait/from_height) retries once without them, then never sends wait again on this client", async () => {
		let calls = 0;
		globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
			calls++;
			const url = new URL(String(input));
			if (url.searchParams.has("wait")) {
				return new Response("bad request: unknown param wait", { status: 400 });
			}
			return new Response(
				JSON.stringify({
					blocks: [],
					next_cursor: null,
					tip: { block_height: 100 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const http = client();
		const tip = await http.getIndexTip({ wait: 10, knownHeight: 99 });
		expect(tip).toBe(100);
		expect(calls).toBe(2); // one 400 with wait, one bare retry

		calls = 0;
		await http.getIndexTip({ wait: 10, knownHeight: 100 });
		expect(calls).toBe(1); // wait disabled for this client from here on
	});

	test("a non-400 failure (e.g. 503) is NOT treated as wait-unsupported — it propagates so FallbackBlockSource can fail over", async () => {
		globalThis.fetch = (async () =>
			new Response("service unavailable", {
				status: 503,
			})) as unknown as typeof fetch;
		await expect(
			client().getIndexTip({ wait: 10, knownHeight: 99 }),
		).rejects.toThrow();
	});
});
