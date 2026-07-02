import { describe, expect, test } from "bun:test";
import { buildSyncInfo } from "./subgraphs.ts";

const NO_GAPS = { count: 0, totalMissingBlocks: 0, ranges: [] };

function reindexingLive(
	overrides: Partial<{ lastProcessedBlock: number }> = {},
) {
	return {
		status: "reindexing",
		start_block: null,
		last_processed_block: overrides.lastProcessedBlock ?? 100,
		reindex_from_block: 0,
		reindex_to_block: 1000,
	};
}

describe("buildSyncInfo", () => {
	test("queued op: shows queue position + estimated start, no etaSeconds", () => {
		const info = buildSyncInfo(reindexingLive(), 1000, NO_GAPS, "complete", {
			status: "queued",
			estimatedEvents: 5000,
			processedEvents: null,
			startedAt: null,
			queuePosition: 2,
			medianDurationSeconds: 60,
		});
		expect(info.queue).toEqual({
			position: 2,
			estimatedEvents: 5000,
			estimatedStartSeconds: 120,
		});
		expect(info.etaSeconds).toBeUndefined();
	});

	test("running op with event estimate: computes etaSeconds from event rate", () => {
		const startedAt = new Date(Date.now() - 60_000); // 60s ago
		const info = buildSyncInfo(reindexingLive(), 1000, NO_GAPS, "complete", {
			status: "running",
			estimatedEvents: 1000,
			processedEvents: 100, // 100 events / 60s = ~1.67/s
			startedAt,
			queuePosition: null,
			medianDurationSeconds: null,
		});
		// (1000 - 100) / (100/60) = 540s
		expect(info.etaSeconds).toBe(540);
	});

	test("running op with event estimate but under the 30s floor: no etaSeconds yet", () => {
		const startedAt = new Date(Date.now() - 5_000); // 5s ago
		const info = buildSyncInfo(reindexingLive(), 1000, NO_GAPS, "complete", {
			status: "running",
			estimatedEvents: 1000,
			processedEvents: 50,
			startedAt,
			queuePosition: null,
			medianDurationSeconds: null,
		});
		expect(info.etaSeconds).toBeNull();
	});

	test("running op with NO event estimate (heavy op): falls back to block-rate etaSeconds", () => {
		const startedAt = new Date(Date.now() - 100_000); // 100s ago
		// processedBlocks is inclusive: lastProcessedBlock(100) - startBlock(0) + 1 = 101
		// blocks in 100s ≈ 1.01 blk/s; blocksRemaining = 1000 - 100 = 900 → eta ≈ 891s.
		const info = buildSyncInfo(
			reindexingLive({ lastProcessedBlock: 100 }),
			1000,
			NO_GAPS,
			"complete",
			{
				status: "running",
				estimatedEvents: null,
				processedEvents: null,
				startedAt,
				queuePosition: null,
				medianDurationSeconds: null,
			},
		);
		expect(info.estimatedEvents).toBeUndefined();
		expect(info.etaSeconds).toBe(891);
	});

	test("running op with no estimate and under the 30s floor: no etaSeconds yet", () => {
		const startedAt = new Date(Date.now() - 5_000);
		const info = buildSyncInfo(
			reindexingLive({ lastProcessedBlock: 100 }),
			1000,
			NO_GAPS,
			"complete",
			{
				status: "running",
				estimatedEvents: null,
				processedEvents: null,
				startedAt,
				queuePosition: null,
				medianDurationSeconds: null,
			},
		);
		expect(info.etaSeconds).toBeNull();
	});

	test("running op with no estimate and zero blocks processed: no etaSeconds (avoids div-by-zero)", () => {
		const startedAt = new Date(Date.now() - 60_000);
		const info = buildSyncInfo(
			reindexingLive({ lastProcessedBlock: -1 }), // processedBlocks clamps to 0
			1000,
			NO_GAPS,
			"complete",
			{
				status: "running",
				estimatedEvents: null,
				processedEvents: null,
				startedAt,
				queuePosition: null,
				medianDurationSeconds: null,
			},
		);
		expect(info.etaSeconds).toBeNull();
	});

	test("no active op: no queue/estimate/eta fields at all", () => {
		const info = buildSyncInfo(
			reindexingLive(),
			1000,
			NO_GAPS,
			"complete",
			undefined,
		);
		expect(info.queue).toBeUndefined();
		expect(info.estimatedEvents).toBeUndefined();
		expect(info.etaSeconds).toBeUndefined();
	});
});
