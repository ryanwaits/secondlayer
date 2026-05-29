import { describe, expect, test } from "bun:test";
import {
	STREAMS_IMMUTABLE_CACHE_CONTROL,
	STREAMS_MUTABLE_CACHE_CONTROL,
	isFinalizedHeight,
	matchesIfNoneMatch,
	streamsETag,
	streamsEventsCacheControl,
	streamsEventsCachePlan,
} from "./cache.ts";
import type { StreamsTip } from "./tip.ts";

const TIP: StreamsTip = {
	block_height: 1000,
	block_hash: "0x01",
	burn_block_height: 2000,
	finalized_height: 900,
	lag_seconds: 0,
};

function params(query: string) {
	return new URL(`http://localhost/v1/streams/events${query}`).searchParams;
}

describe("isFinalizedHeight", () => {
	test("true at or below the boundary, false above or undefined", () => {
		expect(isFinalizedHeight(900, TIP)).toBe(true);
		expect(isFinalizedHeight(899, TIP)).toBe(true);
		expect(isFinalizedHeight(901, TIP)).toBe(false);
		expect(isFinalizedHeight(undefined, TIP)).toBe(false);
	});
});

describe("streamsEventsCacheControl", () => {
	test("immutable for a closed range ending at or below the boundary", () => {
		expect(streamsEventsCacheControl(params("?to_height=900"), TIP)).toBe(
			STREAMS_IMMUTABLE_CACHE_CONTROL,
		);
		expect(
			streamsEventsCacheControl(params("?from_height=0&to_height=500"), TIP),
		).toBe(STREAMS_IMMUTABLE_CACHE_CONTROL);
	});

	test("mutable for a default (tip-spanning) request", () => {
		expect(streamsEventsCacheControl(params(""), TIP)).toBe(
			STREAMS_MUTABLE_CACHE_CONTROL,
		);
	});

	test("mutable when the explicit range crosses the boundary", () => {
		expect(streamsEventsCacheControl(params("?to_height=950"), TIP)).toBe(
			STREAMS_MUTABLE_CACHE_CONTROL,
		);
	});

	test("cache key isolates distinct payload filters", () => {
		const base = streamsEventsCachePlan(params("?to_height=900"), TIP).cacheKey;
		const bySender = streamsEventsCachePlan(
			params("?to_height=900&sender=SP1"),
			TIP,
		).cacheKey;
		const byRecipient = streamsEventsCachePlan(
			params("?to_height=900&recipient=SP1"),
			TIP,
		).cacheKey;
		expect(base).not.toBe(bySender);
		expect(bySender).not.toBe(byRecipient);
	});
});

describe("streamsETag", () => {
	test("stable for identical bodies, distinct for different bodies", () => {
		expect(streamsETag('{"a":1}')).toBe(streamsETag('{"a":1}'));
		expect(streamsETag('{"a":1}')).not.toBe(streamsETag('{"a":2}'));
	});

	test("emits a weak validator", () => {
		expect(streamsETag("{}").startsWith('W/"')).toBe(true);
	});
});

describe("matchesIfNoneMatch", () => {
	const etag = streamsETag('{"a":1}');

	test("matches the same tag and weak/strong variants", () => {
		expect(matchesIfNoneMatch(etag, etag)).toBe(true);
		expect(matchesIfNoneMatch(etag.replace(/^W\//, ""), etag)).toBe(true);
		expect(matchesIfNoneMatch("*", etag)).toBe(true);
		expect(matchesIfNoneMatch(`"other", ${etag}`, etag)).toBe(true);
	});

	test("does not match a different or absent tag", () => {
		expect(matchesIfNoneMatch(streamsETag('{"a":2}'), etag)).toBe(false);
		expect(matchesIfNoneMatch(undefined, etag)).toBe(false);
		expect(matchesIfNoneMatch("", etag)).toBe(false);
	});
});
