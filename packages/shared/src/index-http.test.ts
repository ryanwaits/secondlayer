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
