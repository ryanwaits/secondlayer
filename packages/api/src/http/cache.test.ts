import { describe, expect, test } from "bun:test";
import {
	IMMUTABLE_CACHE_CONTROL,
	MUTABLE_CACHE_CONTROL,
	cacheControl,
	etag,
	matchesIfNoneMatch,
} from "./cache.ts";

describe("http cache primitives", () => {
	test("cacheControl maps finality to the immutable/mutable directive", () => {
		expect(cacheControl(true)).toBe(IMMUTABLE_CACHE_CONTROL);
		expect(cacheControl(false)).toBe(MUTABLE_CACHE_CONTROL);
	});

	test("etag is a stable weak tag for identical bodies", () => {
		const body = JSON.stringify({ events: [], next_cursor: null });
		expect(etag(body)).toBe(etag(body));
		expect(etag(body)).toMatch(/^W\/".+"$/);
		expect(etag(body)).not.toBe(etag(`${body} `));
	});

	test("matchesIfNoneMatch uses weak comparison and honors '*'", () => {
		const tag = etag("body");
		expect(matchesIfNoneMatch(tag, tag)).toBe(true);
		// Weak vs strong forms of the same opaque value match (RFC 7232 §3.2).
		expect(matchesIfNoneMatch(tag.replace(/^W\//, ""), tag)).toBe(true);
		expect(matchesIfNoneMatch("*", tag)).toBe(true);
		expect(matchesIfNoneMatch(`"other", ${tag}`, tag)).toBe(true);
		expect(matchesIfNoneMatch('"other"', tag)).toBe(false);
		expect(matchesIfNoneMatch(null, tag)).toBe(false);
		expect(matchesIfNoneMatch(undefined, tag)).toBe(false);
	});
});
