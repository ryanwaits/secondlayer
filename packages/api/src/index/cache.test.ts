import { describe, expect, test } from "bun:test";
import {
	IMMUTABLE_CACHE_CONTROL,
	MUTABLE_CACHE_CONTROL,
} from "../http/cache.ts";
import { indexCachePlan } from "./cache.ts";
import type { IndexTip } from "./tip.ts";

const TIP: IndexTip = {
	block_height: 30_000,
	finalized_height: 29_994,
	lag_seconds: 0,
};

function params(query: string) {
	return new URL(`http://localhost/v1/index/events${query}`).searchParams;
}

describe("index cache plan", () => {
	test("a fully-finalized range is immutable", () => {
		const plan = indexCachePlan(params("?from_height=0&to_height=29994"), TIP);
		expect(plan.fullyFinalized).toBe(true);
		expect(plan.cacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
	});

	test("a range ending above finality is mutable", () => {
		const plan = indexCachePlan(params("?from_height=0&to_height=29995"), TIP);
		expect(plan.fullyFinalized).toBe(false);
		expect(plan.cacheControl).toBe(MUTABLE_CACHE_CONTROL);
	});

	test("the default tip-spanning window is mutable", () => {
		// No window params → to_height resolves to the tip, which is past finality.
		const plan = indexCachePlan(params(""), TIP);
		expect(plan.fullyFinalized).toBe(false);
		expect(plan.cacheControl).toBe(MUTABLE_CACHE_CONTROL);
	});

	test("a cursor past the tip is never immutable", () => {
		const plan = indexCachePlan(params("?from_cursor=40000:0"), TIP);
		expect(plan.fullyFinalized).toBe(false);
		expect(plan.cacheControl).toBe(MUTABLE_CACHE_CONTROL);
	});

	test("a finalized range addressed by cursor is immutable", () => {
		const plan = indexCachePlan(
			params("?from_cursor=10000:0&to_height=29994"),
			TIP,
		);
		expect(plan.fullyFinalized).toBe(true);
		expect(plan.cacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
	});
});
