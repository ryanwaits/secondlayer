import type { SubgraphOperation } from "@/lib/types";

// Pure derivation for the subgraph status pill's job-state view. Kept apart
// from `live-status.tsx` so the selection/labelling/analytics rules are
// unit-testable without rendering — the component is the shell, this is the
// logic.

const ACTIVE_STATUSES = new Set<SubgraphOperation["status"]>([
	"queued",
	"running",
]);

const TERMINAL_STATUSES = new Set<SubgraphOperation["status"]>([
	"completed",
	"failed",
	"cancelled",
]);

export type OperationDisplay =
	| { phase: "active"; op: SubgraphOperation }
	| { phase: "terminal"; op: SubgraphOperation };

/**
 * How long a finished job stays on the pill. It is held persistently rather
 * than on a short timer — a backfill that failed while nobody was watching
 * should still be there to find — but not forever: past this, last week's
 * completion is noise on every page load, not status.
 */
export const TERMINAL_DISPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How recently a job must have finished for its terminal event to fire. The
 * dedupe list is the primary guard; this bounds the damage when it is lost
 * (cleared storage, a different browser), so opening the page never
 * back-dates a pile of historical completions into the funnel.
 */
export const TERMINAL_REPORT_WINDOW_MS = 30 * 60 * 1000;

/** When the job reached its terminal state. */
function finishedAtMs(op: SubgraphOperation): number {
	return Date.parse(op.finishedAt ?? op.updatedAt);
}

function newestFirst(ops: readonly SubgraphOperation[]): SubgraphOperation[] {
	// The API already returns newest-first; sorting makes this module correct
	// on its own terms rather than dependent on an unstated ordering promise.
	return [...ops].sort(
		(a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
	);
}

/**
 * What the pill should show, given the subgraph's recent operations.
 *
 * An in-flight job always wins. Otherwise the most recent finished job is
 * held until the user dismisses it (or the display window lapses), so a
 * backfill that failed while nobody was looking is still there to be found.
 * Returns null when there is nothing job-related to say and the pill falls
 * back to its ordinary sync/health state.
 */
export function selectDisplayOperation(
	ops: readonly SubgraphOperation[],
	options: {
		dismissedOpIds?: ReadonlySet<string>;
		now?: number;
	} = {},
): OperationDisplay | null {
	const { dismissedOpIds = new Set<string>(), now = Date.now() } = options;
	const sorted = newestFirst(ops);
	const active = sorted.find((op) => ACTIVE_STATUSES.has(op.status));
	if (active) return { phase: "active", op: active };

	const terminal = sorted.find((op) => TERMINAL_STATUSES.has(op.status));
	if (
		terminal &&
		!dismissedOpIds.has(terminal.id) &&
		now - finishedAtMs(terminal) < TERMINAL_DISPLAY_WINDOW_MS
	) {
		return { phase: "terminal", op: terminal };
	}
	return null;
}

/**
 * Whether a finished job's terminal event should fire now. Guards against the
 * two ways a naive "capture on terminal status" double-counts: re-reporting
 * across polls/reloads, and back-dating history on a cold page load.
 */
export function shouldReportTerminal(
	op: SubgraphOperation,
	reportedOpIds: ReadonlySet<string>,
	now: number = Date.now(),
): boolean {
	if (!TERMINAL_STATUSES.has(op.status)) return false;
	if (reportedOpIds.has(op.id)) return false;
	return now - finishedAtMs(op) < TERMINAL_REPORT_WINDOW_MS;
}

const KIND_LABELS: Record<SubgraphOperation["kind"], string> = {
	backfill: "Backfill",
	reindex: "Reindex",
};

const KIND_PROGRESSIVE: Record<SubgraphOperation["kind"], string> = {
	backfill: "Backfilling",
	reindex: "Reindexing",
};

/** Compact human label, e.g. "Backfilling", "Backfill failed", "Queued". */
export function operationLabel(op: SubgraphOperation): string {
	switch (op.status) {
		case "queued":
			return `${KIND_LABELS[op.kind]} queued`;
		case "running":
			return KIND_PROGRESSIVE[op.kind];
		case "completed":
			return `${KIND_LABELS[op.kind]} complete`;
		case "failed":
			return `${KIND_LABELS[op.kind]} failed`;
		case "cancelled":
			return `${KIND_LABELS[op.kind]} stopped`;
	}
}

/**
 * The job's block range. A reindex carries no `toBlock` — it always walks to
 * the chain tip — so the tip stands in as the upper bound.
 */
export function operationRange(
	op: SubgraphOperation,
	chainTip: number | null,
): { fromBlock: number | null; toBlock: number | null; toIsTip: boolean } {
	const toIsTip = op.toBlock == null;
	return {
		fromBlock: op.fromBlock,
		toBlock: op.toBlock ?? chainTip,
		toIsTip,
	};
}

/**
 * Blocks in an inclusive range. Both bounds are processed, so a single-block
 * backfill is 1 — the one definition of this, shared by the submit form's
 * `_started` event and the pill's terminal events, so the funnel's two ends
 * can't disagree about how big the job was.
 */
export function blockCountForRange(fromBlock: number, toBlock: number): number {
	return toBlock - fromBlock + 1;
}

/** Blocks the job covers, or null when the range isn't fully known. */
export function operationBlockCount(
	op: SubgraphOperation,
	chainTip: number | null,
): number | null {
	const { fromBlock, toBlock } = operationRange(op, chainTip);
	if (fromBlock == null || toBlock == null) return null;
	const count = blockCountForRange(fromBlock, toBlock);
	return count > 0 ? count : null;
}

/**
 * Wall-clock run time from the operation's OWN timestamps rather than the
 * client's clock: correct across a page reload, and correct for a job this
 * browser never started.
 */
export function operationDurationMs(op: SubgraphOperation): number | null {
	if (!op.startedAt || !op.finishedAt) return null;
	const ms = Date.parse(op.finishedAt) - Date.parse(op.startedAt);
	return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** Whole-percent progress, or null when the job has reported no signal. */
export function operationPercent(op: SubgraphOperation): number | null {
	if (op.progress == null) return null;
	return Math.min(100, Math.max(0, Math.round(op.progress * 100)));
}

/** Which `LivePill` state a job display maps onto. */
export function operationPillState(
	display: OperationDisplay,
): "live" | "reindexing" | "error" {
	if (display.phase === "active") return "reindexing";
	return display.op.status === "completed" ? "live" : "error";
}

export function formatDuration(seconds: number): string {
	if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s`;
	if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
	return `${(seconds / 3600).toFixed(1)}h`;
}

export function formatDurationMs(ms: number): string {
	return formatDuration(ms / 1000);
}

/**
 * Where the job was started from. Ops begun in this browser tab are tagged at
 * submit time; anything else reached the queue through the CLI or SDK. Both
 * are reported — a backfill that fails is a reliability signal wherever it
 * came from — and the started→completed funnel filters to `console`, which is
 * the only surface that emits a matching `_started`.
 */
export type OperationSource = "console" | "external";

export interface OperationAnalyticsEvent {
	event: string;
	properties: Record<string, unknown>;
}

/**
 * The terminal PostHog event for a finished job.
 *
 * A user-cancelled job reports as `_failed` with `outcome: "cancelled"`: for
 * the funnel it is simply a non-completion, and folding it in keeps
 * "started but never completed" to a single event to chase. Read the true
 * failure rate off `outcome`, not off the event name.
 */
export function terminalAnalyticsEvent(
	op: SubgraphOperation,
	source: OperationSource,
	chainTip: number | null,
): OperationAnalyticsEvent {
	const completed = op.status === "completed";
	return {
		event: `subgraph_${op.kind}_${completed ? "completed" : "failed"}`,
		properties: {
			operation_id: op.id,
			outcome: op.status,
			source,
			duration_ms: operationDurationMs(op),
			from_block: op.fromBlock,
			to_block: op.toBlock,
			block_count: operationBlockCount(op, chainTip),
			...(completed ? {} : { error: op.error }),
		},
	};
}
