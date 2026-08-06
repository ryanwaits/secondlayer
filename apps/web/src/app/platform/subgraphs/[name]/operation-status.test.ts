import { describe, expect, test } from "bun:test";
import type { SubgraphOperation } from "@/lib/types";
import {
	TERMINAL_DISPLAY_WINDOW_MS,
	TERMINAL_REPORT_WINDOW_MS,
	blockCountForRange,
	operationBlockCount,
	operationDurationMs,
	operationLabel,
	operationPercent,
	operationPillState,
	operationRange,
	selectDisplayOperation,
	shouldReportTerminal,
	terminalAnalyticsEvent,
} from "./operation-status";

const NOW = Date.parse("2026-08-05T12:00:00.000Z");

function op(overrides: Partial<SubgraphOperation> = {}): SubgraphOperation {
	return {
		id: "op-1",
		subgraphName: "bns-names",
		kind: "backfill",
		status: "running",
		weight: "heavy",
		fromBlock: 87_094_000,
		toBlock: 87_102_400,
		processedBlocks: null,
		cursorBlock: null,
		estimatedEvents: null,
		processedEvents: null,
		progress: null,
		error: null,
		startedAt: new Date(NOW - 60_000).toISOString(),
		finishedAt: null,
		createdAt: new Date(NOW - 90_000).toISOString(),
		updatedAt: new Date(NOW - 10_000).toISOString(),
		...overrides,
	};
}

describe("selectDisplayOperation", () => {
	test("prefers a running job over a more recent finished one", () => {
		const running = op({
			id: "running",
			createdAt: new Date(NOW).toISOString(),
		});
		const done = op({
			id: "done",
			status: "completed",
			createdAt: new Date(NOW + 1_000).toISOString(),
			finishedAt: new Date(NOW).toISOString(),
		});
		const result = selectDisplayOperation([done, running], { now: NOW });
		expect(result).toEqual({ phase: "active", op: running });
	});

	test("holds a finished job so a failure nobody watched is still findable", () => {
		const failed = op({
			status: "failed",
			error: "handler threw",
			finishedAt: new Date(NOW - 60_000).toISOString(),
		});
		const result = selectDisplayOperation([failed], { now: NOW });
		expect(result).toEqual({ phase: "terminal", op: failed });
	});

	test("does not resurrect a job the user dismissed", () => {
		const failed = op({
			id: "dismissed-op",
			status: "failed",
			finishedAt: new Date(NOW - 60_000).toISOString(),
		});
		const result = selectDisplayOperation([failed], {
			now: NOW,
			dismissedOpIds: new Set(["dismissed-op"]),
		});
		expect(result).toBeNull();
	});

	test("stops showing a finished job once the display window lapses", () => {
		const done = op({
			status: "completed",
			finishedAt: new Date(
				NOW - TERMINAL_DISPLAY_WINDOW_MS - 1_000,
			).toISOString(),
		});
		expect(selectDisplayOperation([done], { now: NOW })).toBeNull();
	});

	test("returns null when there is no job to report", () => {
		expect(selectDisplayOperation([], { now: NOW })).toBeNull();
	});

	test("picks the newest job regardless of the order it arrives in", () => {
		const older = op({
			id: "older",
			status: "completed",
			createdAt: new Date(NOW - 20_000).toISOString(),
			finishedAt: new Date(NOW - 15_000).toISOString(),
		});
		const newer = op({
			id: "newer",
			status: "failed",
			createdAt: new Date(NOW - 5_000).toISOString(),
			finishedAt: new Date(NOW - 1_000).toISOString(),
		});
		const result = selectDisplayOperation([older, newer], { now: NOW });
		expect(result?.op.id).toBe("newer");
	});
});

describe("shouldReportTerminal", () => {
	const finished = op({
		status: "completed",
		finishedAt: new Date(NOW - 5_000).toISOString(),
	});

	test("reports a job that just finished", () => {
		expect(shouldReportTerminal(finished, new Set(), NOW)).toBe(true);
	});

	test("never reports the same job twice", () => {
		expect(shouldReportTerminal(finished, new Set(["op-1"]), NOW)).toBe(false);
	});

	test("never reports a still-running job", () => {
		expect(shouldReportTerminal(op(), new Set(), NOW)).toBe(false);
	});

	test("does not back-date history into the funnel on a cold page load", () => {
		// Without this bound, a browser with cleared storage would emit a
		// terminal event for every old job the operations list still carries.
		const stale = op({
			status: "completed",
			finishedAt: new Date(
				NOW - TERMINAL_REPORT_WINDOW_MS - 1_000,
			).toISOString(),
		});
		expect(shouldReportTerminal(stale, new Set(), NOW)).toBe(false);
	});
});

describe("blockCountForRange", () => {
	test("counts both bounds — a single-block backfill is 1", () => {
		expect(blockCountForRange(185_000, 185_000)).toBe(1);
	});

	test("counts an inclusive range", () => {
		expect(blockCountForRange(87_094_000, 87_102_400)).toBe(8_401);
	});
});

describe("operationRange", () => {
	test("substitutes the chain tip for a reindex's open upper bound", () => {
		const reindex = op({ kind: "reindex", toBlock: null, fromBlock: 1 });
		expect(operationRange(reindex, 87_110_000)).toEqual({
			fromBlock: 1,
			toBlock: 87_110_000,
			toIsTip: true,
		});
	});

	test("uses the job's own bounds for a backfill", () => {
		expect(operationRange(op(), 87_110_000)).toEqual({
			fromBlock: 87_094_000,
			toBlock: 87_102_400,
			toIsTip: false,
		});
	});

	test("block count falls back to the tip when the job has no upper bound", () => {
		const reindex = op({ kind: "reindex", toBlock: null, fromBlock: 1 });
		expect(operationBlockCount(reindex, 100)).toBe(100);
	});

	test("block count is null when the range is unknowable", () => {
		const reindex = op({ kind: "reindex", toBlock: null, fromBlock: null });
		expect(operationBlockCount(reindex, null)).toBeNull();
	});
});

describe("operationDurationMs", () => {
	test("measures the job's own timestamps, not the client's clock", () => {
		const done = op({
			status: "completed",
			startedAt: "2026-08-05T11:55:00.000Z",
			finishedAt: "2026-08-05T11:59:30.000Z",
		});
		expect(operationDurationMs(done)).toBe(270_000);
	});

	test("is null while the job is still running", () => {
		expect(operationDurationMs(op())).toBeNull();
	});
});

describe("operationPercent", () => {
	test("is null when the job has reported no progress signal", () => {
		expect(operationPercent(op({ progress: null }))).toBeNull();
	});

	test("rounds a fraction to whole percent", () => {
		expect(operationPercent(op({ progress: 0.3412 }))).toBe(34);
	});

	test("clamps a progress overshoot rather than rendering 103%", () => {
		expect(operationPercent(op({ progress: 1.03 }))).toBe(100);
	});
});

describe("operationLabel / operationPillState", () => {
	test("names the in-flight job by what it is doing", () => {
		expect(operationLabel(op())).toBe("Backfilling");
		expect(operationLabel(op({ kind: "reindex" }))).toBe("Reindexing");
		expect(operationLabel(op({ status: "queued" }))).toBe("Backfill queued");
	});

	test("names a finished job by its outcome", () => {
		expect(operationLabel(op({ status: "completed" }))).toBe(
			"Backfill complete",
		);
		expect(operationLabel(op({ status: "failed" }))).toBe("Backfill failed");
		expect(operationLabel(op({ status: "cancelled" }))).toBe(
			"Backfill stopped",
		);
	});

	test("a finished-failed job turns the pill red, a completed one green", () => {
		expect(operationPillState({ phase: "active", op: op() })).toBe(
			"reindexing",
		);
		expect(
			operationPillState({
				phase: "terminal",
				op: op({ status: "completed" }),
			}),
		).toBe("live");
		expect(
			operationPillState({ phase: "terminal", op: op({ status: "failed" }) }),
		).toBe("error");
	});
});

describe("terminalAnalyticsEvent", () => {
	test("a completed backfill carries duration and range for the funnel", () => {
		const done = op({
			status: "completed",
			startedAt: "2026-08-05T11:55:00.000Z",
			finishedAt: "2026-08-05T11:59:30.000Z",
		});
		expect(terminalAnalyticsEvent(done, "console", 87_110_000)).toEqual({
			event: "subgraph_backfill_completed",
			properties: {
				operation_id: "op-1",
				outcome: "completed",
				source: "console",
				duration_ms: 270_000,
				from_block: 87_094_000,
				to_block: 87_102_400,
				block_count: 8_401,
			},
		});
	});

	test("a failed job carries the error", () => {
		const failed = op({
			status: "failed",
			error: "handler threw",
			finishedAt: new Date(NOW).toISOString(),
		});
		const result = terminalAnalyticsEvent(failed, "external", null);
		expect(result.event).toBe("subgraph_backfill_failed");
		expect(result.properties.error).toBe("handler threw");
		expect(result.properties.source).toBe("external");
	});

	test("a cancelled job stays distinguishable from a real failure", () => {
		// It shares the `_failed` event name so "started but never completed" is
		// one thing to chase — the true failure rate reads off `outcome`.
		const stopped = op({
			status: "cancelled",
			finishedAt: new Date(NOW).toISOString(),
		});
		const result = terminalAnalyticsEvent(stopped, "console", null);
		expect(result.event).toBe("subgraph_backfill_failed");
		expect(result.properties.outcome).toBe("cancelled");
	});

	test("names the event after the job kind", () => {
		const done = op({
			kind: "reindex",
			status: "completed",
			finishedAt: new Date(NOW).toISOString(),
		});
		expect(terminalAnalyticsEvent(done, "console", null).event).toBe(
			"subgraph_reindex_completed",
		);
	});
});
