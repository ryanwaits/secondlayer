import { describe, expect, test } from "bun:test";
import type { SubgraphOperation } from "@secondlayer/shared/db";
import { buildSyncInfo, deriveOperationProgress } from "./subgraphs.ts";

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

// ── deriveOperationProgress ─────────────────────────────────────────────

function operation(overrides: Record<string, unknown> = {}): SubgraphOperation {
	return {
		id: "op-1",
		subgraph_id: "sg-1",
		subgraph_name: "bns-names",
		account_id: null,
		kind: "backfill",
		status: "running",
		from_block: 1000,
		to_block: 1999,
		cancel_requested: false,
		locked_by: null,
		locked_until: null,
		started_at: null,
		finished_at: null,
		processed_blocks: null,
		error: null,
		created_at: new Date(),
		updated_at: new Date(),
		weight: "heavy",
		estimated_events: null,
		processed_events: null,
		cursor_block: null,
		...overrides,
	} as SubgraphOperation;
}

describe("deriveOperationProgress", () => {
	test("a running backfill reports progress from its cursor checkpoint", () => {
		// The whole point of the fallback: a backfill writes neither
		// processed_events (reindex-only flush) nor processed_blocks (terminal
		// only), so without the cursor it reports null for its entire run.
		const op = operation({ cursor_block: 1499 });
		expect(deriveOperationProgress(op, 1000, 1000)).toBe(0.5);
	});

	test("the cursor counts inclusively — its own block is committed", () => {
		expect(
			deriveOperationProgress(operation({ cursor_block: 1000 }), 1000, 1000),
		).toBe(0.001);
	});

	test("a cursor behind the range floors at zero instead of going negative", () => {
		const op = operation({ cursor_block: 500 });
		expect(deriveOperationProgress(op, 1000, 1000)).toBe(0);
	});

	test("event counts win over the cursor when the estimate exists", () => {
		const op = operation({
			estimated_events: 400,
			processed_events: 100,
			cursor_block: 1900,
		});
		expect(deriveOperationProgress(op, 1000, 1000)).toBe(0.25);
	});

	test("a completed op is 1 even with no progress signal recorded", () => {
		expect(
			deriveOperationProgress(operation({ status: "completed" }), 1000, 1000),
		).toBe(1);
	});

	test("null when the op has reported nothing at all", () => {
		expect(deriveOperationProgress(operation(), 1000, 1000)).toBeNull();
	});
});
