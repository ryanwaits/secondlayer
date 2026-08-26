import { describe, expect, test } from "bun:test";
import { PostgresBlockSource, resolveBlockSource } from "./block-source.ts";
import { ObserverHttpBlockSource } from "./observer-http-source.ts";

async function loadFixture(name: string): Promise<unknown> {
	const url = new URL(
		`../../../indexer/test/fixtures/observer/${name}`,
		import.meta.url,
	);
	return JSON.parse(await Bun.file(url).text()) as unknown;
}

type MockCall = { url: string; headers: Headers };

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("ObserverHttpBlockSource", () => {
	test("loadBlockRange maps two /new_block fixtures from one page", async () => {
		const p100 = await loadFixture("new_block.timestamp.json");
		const p101 = await loadFixture("new_block.burn_block_time.json");
		const calls: MockCall[] = [];

		const source = new ObserverHttpBlockSource({
			baseUrl: "http://127.0.0.1:3700",
			fetch: async (input, init) => {
				const url = String(input);
				calls.push({
					url,
					headers: new Headers(init?.headers),
				});
				return jsonResponse({
					events: [
						{
							path: "/new_block",
							payload: p100,
							content_sha256: "a",
							block_height: 100,
							index_block_hash: "0xbbb222",
						},
						{
							path: "/new_block",
							payload: p101,
							content_sha256: "b",
							block_height: 101,
							index_block_hash: "0x222bbb",
						},
					],
					next: null,
				});
			},
		});

		const map = await source.loadBlockRange(100, 101);
		expect(map.size).toBe(2);
		expect(map.get(100)?.block.index_block_hash).toBe("0xbbb222");
		expect(map.get(100)?.block.timestamp).toBe(1700000000);
		expect(map.get(100)?.txs).toEqual([]);
		expect(map.get(100)?.events).toEqual([]);
		expect(map.get(101)?.block.index_block_hash).toBe("0x222bbb");
		expect(map.get(101)?.block.timestamp).toBe(1700000001);
		expect(map.get(101)?.txs).toEqual([]);
		expect(map.get(101)?.events).toEqual([]);
		expect(calls[0]?.url).toContain("path=%2Fnew_block");
		expect(calls[0]?.url).toContain("after_height=99");
	});

	test("empty page → empty Map", async () => {
		const source = new ObserverHttpBlockSource({
			baseUrl: "http://127.0.0.1:3700/",
			fetch: async () => jsonResponse({ events: [], next: null }),
		});
		const map = await source.loadBlockRange(1, 10);
		expect(map.size).toBe(0);
	});

	test("two-page cursor: second request uses next cursor", async () => {
		const p100 = await loadFixture("new_block.timestamp.json");
		const p101 = await loadFixture("new_block.burn_block_time.json");
		const urls: string[] = [];

		const source = new ObserverHttpBlockSource({
			baseUrl: "http://127.0.0.1:3700",
			fetch: async (input) => {
				const url = String(input);
				urls.push(url);
				if (urls.length === 1) {
					return jsonResponse({
						events: [
							{
								path: "/new_block",
								payload: p100,
								content_sha256: "a",
								block_height: 100,
								index_block_hash: "0xbbb222",
							},
						],
						next: {
							after_height: 100,
							after_index_block_hash: "0xbbb222",
						},
					});
				}
				return jsonResponse({
					events: [
						{
							path: "/new_block",
							payload: p101,
							content_sha256: "b",
							block_height: 101,
							index_block_hash: "0x222bbb",
						},
					],
					next: null,
				});
			},
		});

		const map = await source.loadBlockRange(100, 101);
		expect(map.size).toBe(2);
		expect(map.has(100)).toBe(true);
		expect(map.has(101)).toBe(true);
		expect(urls).toHaveLength(2);
		expect(urls[1]).toContain("after_height=100");
		expect(urls[1]).toContain("after_index_block_hash=0xbbb222");
	});

	test("invalid /new_block missing block_height → throw", async () => {
		const source = new ObserverHttpBlockSource({
			baseUrl: "http://127.0.0.1:3700",
			fetch: async () =>
				jsonResponse({
					events: [
						{
							path: "/new_block",
							payload: {
								index_block_hash: "0xabc",
								transactions: [],
								events: [],
							},
							content_sha256: "x",
							block_height: null,
							index_block_hash: "0xabc",
						},
					],
					next: null,
				}),
		});
		await expect(source.loadBlockRange(1, 10)).rejects.toThrow(
			/block_height or index_block_hash/,
		);
	});

	test("getTip reads /internal/observer-events/tip", async () => {
		const urls: string[] = [];
		const source = new ObserverHttpBlockSource({
			baseUrl: "http://127.0.0.1:3700",
			token: "secret",
			fetch: async (input, init) => {
				urls.push(String(input));
				expect(new Headers(init?.headers).get("Authorization")).toBe(
					"Bearer secret",
				);
				return jsonResponse({
					block_height: 101,
					index_block_hash: "0x222bbb",
				});
			},
		});
		expect(await source.getTip()).toBe(101);
		expect(urls[0]).toBe("http://127.0.0.1:3700/internal/observer-events/tip");
	});
});

describe("resolveBlockSource observer-http flag", () => {
	test("default unset env → PostgresBlockSource", () => {
		const prevSource = process.env.SUBGRAPH_SOURCE;
		const prevUrl = process.env.OBSERVER_HTTP_URL;
		try {
			delete process.env.SUBGRAPH_SOURCE;
			delete process.env.OBSERVER_HTTP_URL;
			const source = resolveBlockSource();
			expect(source).toBeInstanceOf(PostgresBlockSource);
		} finally {
			if (prevSource === undefined) delete process.env.SUBGRAPH_SOURCE;
			else process.env.SUBGRAPH_SOURCE = prevSource;
			if (prevUrl === undefined) delete process.env.OBSERVER_HTTP_URL;
			else process.env.OBSERVER_HTTP_URL = prevUrl;
		}
	});

	test("SUBGRAPH_SOURCE=observer-http + OBSERVER_HTTP_URL → ObserverHttpBlockSource", () => {
		const prevSource = process.env.SUBGRAPH_SOURCE;
		const prevUrl = process.env.OBSERVER_HTTP_URL;
		const prevToken = process.env.OBSERVER_HTTP_EXPORT_TOKEN;
		try {
			process.env.SUBGRAPH_SOURCE = "observer-http";
			process.env.OBSERVER_HTTP_URL = "http://127.0.0.1:3700";
			delete process.env.OBSERVER_HTTP_EXPORT_TOKEN;
			const source = resolveBlockSource();
			expect(source).toBeInstanceOf(ObserverHttpBlockSource);
		} finally {
			if (prevSource === undefined) delete process.env.SUBGRAPH_SOURCE;
			else process.env.SUBGRAPH_SOURCE = prevSource;
			if (prevUrl === undefined) delete process.env.OBSERVER_HTTP_URL;
			else process.env.OBSERVER_HTTP_URL = prevUrl;
			if (prevToken === undefined)
				delete process.env.OBSERVER_HTTP_EXPORT_TOKEN;
			else process.env.OBSERVER_HTTP_EXPORT_TOKEN = prevToken;
		}
	});
});
