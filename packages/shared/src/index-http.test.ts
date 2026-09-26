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

	test("sends tip_only (it never reads blocks[]) but omits wait/from_height when no opts are given", async () => {
		const { urls } = stubFetchCapturingUrl({
			blocks: [],
			next_cursor: null,
			tip: { block_height: 100 },
		});
		await client().getIndexTip();
		const url = new URL(urls[0] ?? "");
		expect(url.searchParams.get("tip_only")).toBe("true");
		expect(url.searchParams.get("wait")).toBeNull();
		expect(url.searchParams.get("from_height")).toBeNull();
	});

	test("getIndexSourceTip() never sends tip_only — its knownHeight baseline is the source tip, so the row-based emptiness check is already correct", async () => {
		const { urls } = stubFetchCapturingUrl({
			blocks: [],
			next_cursor: null,
			tip: { block_height: 100, source_block_height: 100 },
		});
		await client().getIndexSourceTip({ wait: 10, knownHeight: 99 });
		const url = new URL(urls[0] ?? "");
		expect(url.searchParams.get("tip_only")).toBeNull();
		expect(url.searchParams.get("wait")).toBe("10");
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

	test("sends event_types (comma-joined) alongside tip_only, so the server narrows the tip/wait to just those decoders", async () => {
		const { urls } = stubFetchCapturingUrl({
			blocks: [],
			next_cursor: null,
			tip: { block_height: 105, decoded_heights: { ft_transfer: 105 } },
		});
		await client().getIndexTip({
			wait: 10,
			knownHeight: 100,
			eventTypes: ["ft_transfer", "stx_transfer"],
		});
		const url = new URL(urls[0] ?? "");
		expect(url.searchParams.get("event_types")).toBe(
			"ft_transfer,stx_transfer",
		);
	});

	test("omits event_types when none are given — the global-floor default is unchanged", async () => {
		const { urls } = stubFetchCapturingUrl({
			blocks: [],
			next_cursor: null,
			tip: { block_height: 100 },
		});
		await client().getIndexTip({ wait: 10, knownHeight: 99 });
		const url = new URL(urls[0] ?? "");
		expect(url.searchParams.get("event_types")).toBeNull();
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

	test("a 400 (older server rejects wait/from_height) retries once without them, then never sends wait or tip_only again on this client", async () => {
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

		let lastUrl = "";
		globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
			lastUrl = String(input);
			return new Response(
				JSON.stringify({
					blocks: [],
					next_cursor: null,
					tip: { block_height: 100 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;
		await http.getIndexTip();
		expect(new URL(lastUrl).searchParams.get("tip_only")).toBeNull(); // tip_only disabled too
	});

	test("a 400 caused solely by tip_only (no wait requested) also disables both extensions on this client", async () => {
		let calls = 0;
		globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
			calls++;
			const url = new URL(String(input));
			if (url.searchParams.has("tip_only")) {
				return new Response("bad request: unknown param tip_only", {
					status: 400,
				});
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
		const tip = await http.getIndexTip(); // no wait — only tip_only is at risk
		expect(tip).toBe(100);
		expect(calls).toBe(2); // one 400 with tip_only, one bare retry
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
