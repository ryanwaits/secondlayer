import { afterEach, describe, expect, test } from "bun:test";
import {
	BaseClient,
	type EtagEntry,
	type FetchLike,
	LOCAL_API_URL,
	MemoryEtagCache,
	resolveBaseUrl,
} from "./base.ts";

describe("resolveBaseUrl", () => {
	const saved = {
		SL_API_URL: process.env.SL_API_URL,
		SECONDLAYER_API_URL: process.env.SECONDLAYER_API_URL,
	};

	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) Reflect.deleteProperty(process.env, k);
			else process.env[k] = v;
		}
	});

	test("explicit wins", () => {
		expect(resolveBaseUrl("https://example.test/")).toBe(
			"https://example.test",
		);
	});

	test("SL_API_URL then local default", () => {
		Reflect.deleteProperty(process.env, "SL_API_URL");
		Reflect.deleteProperty(process.env, "SECONDLAYER_API_URL");
		expect(resolveBaseUrl()).toBe(LOCAL_API_URL);
		process.env.SL_API_URL = "http://localhost:3999";
		expect(resolveBaseUrl()).toBe("http://localhost:3999");
	});
});

class ProbeClient extends BaseClient {
	get<T>(path: string) {
		return this.request<T>("GET", path);
	}
	post<T>(path: string, body: unknown) {
		return this.request<T>("POST", path, body);
	}
}

/** A server that tags every page and answers 304 to a matching validator. */
function taggedServer() {
	const seen: (string | null)[] = [];
	const fetchImpl: FetchLike = async (_input, init) => {
		const sent = new Headers(init?.headers).get("If-None-Match");
		seen.push(sent);
		if (sent === '"v1"') return new Response(null, { status: 304 });
		return new Response(JSON.stringify({ events: [1, 2], tip: 10 }), {
			status: 200,
			headers: { ETag: '"v1"' },
		});
	};
	return { seen, fetchImpl };
}

describe("ETag revalidation", () => {
	test("a repeat GET sends If-None-Match and a 304 returns the cached page", async () => {
		const server = taggedServer();
		const client = new ProbeClient({
			baseUrl: "https://api.test",
			fetchImpl: server.fetchImpl,
		});
		const first = await client.get<{ events: number[] }>("/v1/index/events");
		const second = await client.get<{ events: number[] }>("/v1/index/events");
		expect(server.seen).toEqual([null, '"v1"']);
		expect(second).toEqual(first);
		expect(second).not.toBe(first);
	});

	test("etagCache: false never sends a validator", async () => {
		const server = taggedServer();
		const client = new ProbeClient({
			baseUrl: "https://api.test",
			fetchImpl: server.fetchImpl,
			etagCache: false,
		});
		await client.get("/v1/index/events");
		await client.get("/v1/index/events");
		expect(server.seen).toEqual([null, null]);
	});

	test("writes are never revalidated", async () => {
		const server = taggedServer();
		const client = new ProbeClient({
			baseUrl: "https://api.test",
			fetchImpl: server.fetchImpl,
		});
		await client.post("/api/subgraphs", {});
		await client.post("/api/subgraphs", {});
		expect(server.seen).toEqual([null, null]);
	});

	test("a caller-supplied cache receives the page, keyed by full URL", async () => {
		const server = taggedServer();
		const store = new Map<string, EtagEntry>();
		const client = new ProbeClient({
			baseUrl: "https://api.test",
			fetchImpl: server.fetchImpl,
			etagCache: {
				get: (key) => store.get(key),
				set: (key, entry) => void store.set(key, entry),
			},
		});
		await client.get("/v1/index/events?limit=5");
		expect(store.get("https://api.test/v1/index/events?limit=5")?.etag).toBe(
			'"v1"',
		);
	});

	test("the in-memory cache evicts the least recently used page", () => {
		const cache = new MemoryEtagCache(2);
		cache.set("a", { etag: "1", body: "{}" });
		cache.set("b", { etag: "2", body: "{}" });
		cache.get("a");
		cache.set("c", { etag: "3", body: "{}" });
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("a")?.etag).toBe("1");
		expect(cache.get("c")?.etag).toBe("3");
	});
});
