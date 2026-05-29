import { describe, expect, test } from "bun:test";
import { StreamsResponseCache } from "./response-cache.ts";

const page = (cursor: string) => ({
	events: [],
	next_cursor: cursor,
	reorgs: [],
});

describe("StreamsResponseCache", () => {
	test("stores and returns entries by key", () => {
		const cache = new StreamsResponseCache();
		cache.set("a", page("1"));
		expect(cache.get("a")?.next_cursor).toBe("1");
		expect(cache.get("missing")).toBeUndefined();
	});

	test("evicts the least-recently-used entry past the bound", () => {
		const cache = new StreamsResponseCache(2);
		cache.set("a", page("1"));
		cache.set("b", page("2"));
		cache.get("a"); // refresh a -> b is now LRU
		cache.set("c", page("3")); // evicts b
		expect(cache.get("a")?.next_cursor).toBe("1");
		expect(cache.get("c")?.next_cursor).toBe("3");
		expect(cache.get("b")).toBeUndefined();
		expect(cache.size).toBe(2);
	});

	test("clear empties the cache", () => {
		const cache = new StreamsResponseCache();
		cache.set("a", page("1"));
		cache.clear();
		expect(cache.size).toBe(0);
	});
});
