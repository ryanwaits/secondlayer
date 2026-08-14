import { describe, expect, test } from "bun:test";
import { applyMutations, deepVerify, finalRowDigest } from "./deep-verify.ts";

const insert = {
	op: "insert" as const,
	table: "t",
	key: { id: "a" },
	value: { n: 1 },
};

describe("stateful deep verify", () => {
	test("scratch replay matches the live final-row digest", () => {
		const live = applyMutations([], [insert]);
		const result = deepVerify({ live, replay: [insert] });
		expect(result.ok).toBe(true);
		expect(result.live_digest).toBe(result.scratch_digest);
	});

	test("a seeded historical mutation is found", () => {
		const live = applyMutations([], [insert]);
		const seed = {
			op: "update" as const,
			table: "t",
			key: { id: "a" },
			value: { n: 99 },
		};
		const result = deepVerify({ live, replay: [insert], seed });
		expect(result.found_mutation).toBe(true);
		expect(finalRowDigest(applyMutations(live, [seed]))).not.toBe(
			result.live_digest,
		);
	});
});
