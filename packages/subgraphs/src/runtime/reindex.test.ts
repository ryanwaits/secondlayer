import { describe, expect, test } from "bun:test";
import {
	initialReindexProgressBlock,
	resolveReindexResumeBlock,
} from "./reindex.ts";

describe("reindex resume cursor", () => {
	test("initial cursor starts before the reindex range", () => {
		expect(initialReindexProgressBlock(1)).toBe(0);
		expect(initialReindexProgressBlock(250)).toBe(249);
		expect(initialReindexProgressBlock(0)).toBe(0);
	});

	test("resume starts at the larger of recorded progress and reindex start", () => {
		expect(
			resolveReindexResumeBlock({
				last_processed_block: 0,
				reindex_from_block: 100,
				reindex_to_block: 500,
			}),
		).toBe(100);

		expect(
			resolveReindexResumeBlock({
				last_processed_block: 349,
				reindex_from_block: 100,
				reindex_to_block: 500,
			}),
		).toBe(350);
	});

	test("legacy rows without metadata trigger a fresh reindex", () => {
		expect(
			resolveReindexResumeBlock({
				last_processed_block: 500,
				reindex_from_block: null,
				reindex_to_block: null,
			}),
		).toBeNull();
	});
});
