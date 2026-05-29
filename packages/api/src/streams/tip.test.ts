import { describe, expect, test } from "bun:test";
import {
	type StreamsTipBlockReader,
	createStreamsTipProvider,
	getLagSeconds,
} from "./tip.ts";

function tipBlock(height: number, ts: Date) {
	return {
		block_height: height,
		block_hash: `0x${height.toString(16).padStart(64, "0")}`,
		burn_block_height: height + 1000,
		ts,
	};
}

describe("Streams tip provider", () => {
	test("real provider returns expected shape", async () => {
		const provider = createStreamsTipProvider({
			readTip: async () => tipBlock(182_447, new Date(1000)),
			readFinalizedHeight: async () => 182_440,
			now: () => 4000,
		});

		await expect(provider()).resolves.toEqual({
			block_height: 182_447,
			block_hash:
				"0x000000000000000000000000000000000000000000000000000000000002c8af",
			burn_block_height: 183_447,
			finalized_height: 182_440,
			lag_seconds: 3,
		});
	});

	test("maps burn-confirmation boundary to a finalized Stacks height", async () => {
		const seen: number[] = [];
		const provider = createStreamsTipProvider({
			readTip: async () => tipBlock(182_447, new Date(0)),
			btcConfirmations: 6,
			readFinalizedHeight: async (burnCutoff) => {
				seen.push(burnCutoff);
				return 182_400;
			},
			now: () => 0,
		});

		const tip = await provider();
		// burn tip 183_447 - 6 confirmations = 183_441 passed to the reader.
		expect(seen).toEqual([183_441]);
		expect(tip.finalized_height).toBe(182_400);
	});

	test("lag_seconds clamps to 0 on negative clock skew", () => {
		expect(getLagSeconds(new Date(2000), 1000)).toBe(0);
	});

	test("cache returns the same value within the cache window", async () => {
		let calls = 0;
		let nowMs = 1000;
		const readTip: StreamsTipBlockReader = async () => {
			calls++;
			return tipBlock(calls, new Date(0));
		};
		const provider = createStreamsTipProvider({
			readTip,
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
		const readTip: StreamsTipBlockReader = async () => {
			calls++;
			return tipBlock(calls, new Date(0));
		};
		const provider = createStreamsTipProvider({
			readTip,
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
