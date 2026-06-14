import { describe, expect, test } from "bun:test";
import {
	type DecodedTipReader,
	type IndexSourceTipReader,
	createIndexTipProvider,
	getIndexLagSeconds,
} from "./tip.ts";

function sourceTip(height: number, ts: Date): IndexSourceTipReader {
	return async () => ({
		block_height: height,
		block_hash: `0x${height.toString(16).padStart(64, "0")}`,
		burn_block_height: height + 1000,
		ts,
	});
}

describe("Index tip provider", () => {
	test("returns block_height from the decoded tip and finalized_height from source", async () => {
		const provider = createIndexTipProvider({
			// Canonical chain tip is 30_000, but the decoder has only reached 29_900.
			readSourceTip: sourceTip(30_000, new Date(1000)),
			readDecodedTip: async () => ({
				block_height: 29_900,
				ts: new Date(1000),
			}),
			readFinalizedHeight: async () => 29_994,
			now: () => 4000,
		});

		await expect(provider()).resolves.toEqual({
			block_height: 29_900,
			finalized_height: 29_994,
			lag_seconds: 3,
		});
	});

	test("maps the burn-confirmation boundary to a finalized Stacks height", async () => {
		const seen: number[] = [];
		const provider = createIndexTipProvider({
			readSourceTip: sourceTip(30_000, new Date(0)),
			readDecodedTip: async () => ({ block_height: 30_000, ts: new Date(0) }),
			btcConfirmations: 6,
			readFinalizedHeight: async (burnCutoff) => {
				seen.push(burnCutoff);
				return 29_990;
			},
			now: () => 0,
		});

		const tip = await provider();
		// burn tip 31_000 - 6 confirmations = 30_994 passed to the reader.
		expect(seen).toEqual([30_994]);
		expect(tip.finalized_height).toBe(29_990);
	});

	test("falls back to the source tip block when no decoded tip exists", async () => {
		const provider = createIndexTipProvider({
			readSourceTip: sourceTip(30_000, new Date(0)),
			readDecodedTip: async () => null,
			readFinalizedHeight: async () => 29_994,
			now: () => 0,
		});

		const tip = await provider();
		expect(tip.block_height).toBe(30_000);
		expect(tip.finalized_height).toBe(29_994);
	});

	test("throws when no canonical block and empty tip is disallowed (platform)", async () => {
		const provider = createIndexTipProvider({
			readSourceTip: async () => null,
			allowEmptyTip: false,
		});
		await expect(provider()).rejects.toThrow("Index tip unavailable");
	});

	test("serves a zero tip when no canonical block and empty tip is allowed (oss)", async () => {
		const provider = createIndexTipProvider({
			readSourceTip: async () => null,
			allowEmptyTip: true,
		});
		await expect(provider()).resolves.toEqual({
			block_height: 0,
			finalized_height: 0,
			lag_seconds: 0,
		});
	});

	test("lag_seconds clamps to 0 on negative clock skew", () => {
		expect(getIndexLagSeconds(new Date(2000), 1000)).toBe(0);
	});

	test("cache returns the same value within the cache window", async () => {
		let calls = 0;
		let nowMs = 1000;
		const readDecodedTip: DecodedTipReader = async () => {
			calls++;
			return { block_height: calls, ts: new Date(0) };
		};
		const provider = createIndexTipProvider({
			readSourceTip: sourceTip(30_000, new Date(0)),
			readDecodedTip,
			readFinalizedHeight: async () => 0,
			now: () => nowMs,
			cacheTtlMs: 500,
		});

		const first = await provider();
		nowMs = 1499;
		const second = await provider();

		expect(calls).toBe(1);
		expect(second).toEqual(first);
	});

	test("cache refreshes after the cache window expires", async () => {
		let calls = 0;
		let nowMs = 1000;
		const readDecodedTip: DecodedTipReader = async () => {
			calls++;
			return { block_height: calls, ts: new Date(0) };
		};
		const provider = createIndexTipProvider({
			readSourceTip: sourceTip(30_000, new Date(0)),
			readDecodedTip,
			readFinalizedHeight: async () => 0,
			now: () => nowMs,
			cacheTtlMs: 500,
		});

		const first = await provider();
		nowMs = 1500;
		const second = await provider();

		expect(calls).toBe(2);
		expect(first.block_height).toBe(1);
		expect(second.block_height).toBe(2);
	});
});
