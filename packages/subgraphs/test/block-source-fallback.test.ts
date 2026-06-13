import { describe, expect, test } from "bun:test";
import type { BlockData } from "../src/runtime/batch-loader.ts";
import { FallbackBlockSource } from "../src/runtime/block-source.ts";
import type { BlockSource } from "../src/runtime/block-source.ts";

const RANGE: Map<number, BlockData> = new Map();

function source(opts: {
	tip?: number | (() => never);
	range?: Map<number, BlockData> | (() => never);
}): BlockSource {
	return {
		getTip: async () =>
			typeof opts.tip === "function" ? opts.tip() : (opts.tip ?? 0),
		loadBlockRange: async () =>
			typeof opts.range === "function" ? opts.range() : (opts.range ?? RANGE),
	};
}

describe("FallbackBlockSource", () => {
	test("uses the primary when it succeeds (no fallback call)", async () => {
		let fallbackCalls = 0;
		const fallback = source({
			tip: () => {
				fallbackCalls++;
				throw new Error("should not be called");
			},
		});
		const fb = new FallbackBlockSource(source({ tip: 100 }), fallback);
		expect(await fb.getTip()).toBe(100);
		expect(fallbackCalls).toBe(0);
	});

	test("falls back to the secondary when the primary getTip throws", async () => {
		const fb = new FallbackBlockSource(
			source({
				tip: () => {
					throw new Error("api unavailable");
				},
			}),
			source({ tip: 42 }),
		);
		expect(await fb.getTip()).toBe(42);
	});

	test("falls back when the primary loadBlockRange throws", async () => {
		const fbRange = new Map<number, BlockData>([
			[7, { block: { height: 7 } as never, txs: [], events: [] }],
		]);
		const fb = new FallbackBlockSource(
			source({
				range: () => {
					throw new Error("api 503");
				},
			}),
			source({ range: fbRange }),
		);
		const out = await fb.loadBlockRange(1, 10);
		expect(out.has(7)).toBe(true);
	});
});
