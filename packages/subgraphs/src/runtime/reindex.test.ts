import { describe, expect, test } from "bun:test";
import {
	initialReindexProgressBlock,
	resolveReindexBatchConfig,
	resolveReindexResumeBlock,
} from "./reindex.ts";

describe("reindex batch config", () => {
	test("plans use standard batch bounds", () => {
		expect(resolveReindexBatchConfig({})).toEqual({
			defaultBatchSize: 500,
			minBatchSize: 100,
			maxBatchSize: 1000,
		});
		expect(resolveReindexBatchConfig()).toEqual({
			defaultBatchSize: 500,
			minBatchSize: 100,
			maxBatchSize: 1000,
		});
	});

	test("env override clamps default batch size to resolved bounds", () => {
		expect(
			resolveReindexBatchConfig({
				SUBGRAPH_REINDEX_BATCH_SIZE: "500",
				SUBGRAPH_REINDEX_MIN_BATCH_SIZE: "10",
				SUBGRAPH_REINDEX_MAX_BATCH_SIZE: "80",
			}),
		).toEqual({
			defaultBatchSize: 80,
			minBatchSize: 10,
			maxBatchSize: 80,
		});
	});
});

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
