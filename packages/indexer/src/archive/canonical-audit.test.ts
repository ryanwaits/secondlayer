import { describe, expect, test } from "bun:test";
import { summarizeCanonicalContinuity } from "./canonical-audit.ts";

describe("canonical coverage continuity", () => {
	test("includes a missing genesis prefix in the report", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: 3,
				toBlock: 8,
				expectedFromBlock: 0,
				gapCount: 1,
				missingBlocks: 2,
				firstGap: { from_block: 7, to_block: 8 },
				brokenLinkCount: 0,
				firstBrokenLinkHeight: null,
				duplicateHeightCount: 0,
				firstDuplicateHeight: null,
			}),
		).toEqual({
			healthy: false,
			start_mismatch: true,
			prefix_gap: { from_block: 0, to_block: 2 },
			suffix_gap: null,
			suffix_checked: false,
			gap_count: 1,
			missing_blocks: 5,
			first_gap: { from_block: 7, to_block: 8 },
			broken_link_count: 0,
			first_broken_link_height: null,
			duplicate_height_count: 0,
			first_duplicate_height: null,
		});
	});

	test("requires both continuity and ancestry", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: 0,
				toBlock: 42,
				expectedFromBlock: 0,
				gapCount: 0,
				missingBlocks: 0,
				firstGap: null,
				brokenLinkCount: 1,
				firstBrokenLinkHeight: 42,
				duplicateHeightCount: 0,
				firstDuplicateHeight: null,
			}),
		).toMatchObject({
			healthy: false,
			start_mismatch: false,
			suffix_gap: null,
			suffix_checked: false,
			duplicate_height_count: 0,
			broken_link_count: 1,
			first_broken_link_height: 42,
		});
	});

	test("reports a checked finalized suffix gap", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: 0,
				toBlock: 8,
				expectedFromBlock: 0,
				expectedToBlock: 10,
				gapCount: 0,
				missingBlocks: 0,
				firstGap: null,
				brokenLinkCount: 0,
				firstBrokenLinkHeight: null,
				duplicateHeightCount: 0,
				firstDuplicateHeight: null,
			}),
		).toMatchObject({
			healthy: false,
			start_mismatch: false,
			suffix_gap: { from_block: 9, to_block: 10 },
			suffix_checked: true,
			duplicate_height_count: 0,
			missing_blocks: 2,
		});
	});

	test("rejects duplicate canonical heights", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: 0,
				toBlock: 10,
				expectedFromBlock: 0,
				gapCount: 0,
				missingBlocks: 0,
				firstGap: null,
				brokenLinkCount: 0,
				firstBrokenLinkHeight: null,
				duplicateHeightCount: 1,
				firstDuplicateHeight: 7,
			}),
		).toMatchObject({
			healthy: false,
			duplicate_height_count: 1,
			first_duplicate_height: 7,
		});
	});

	test("does not accept an empty canonical range", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: null,
				toBlock: null,
				expectedFromBlock: 0,
				gapCount: 0,
				missingBlocks: 0,
				firstGap: null,
				brokenLinkCount: 0,
				firstBrokenLinkHeight: null,
				duplicateHeightCount: 0,
				firstDuplicateHeight: null,
			}),
		).toMatchObject({
			healthy: false,
			start_mismatch: false,
			prefix_gap: null,
		});
	});
});
