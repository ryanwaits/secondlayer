import type { SubgraphOperation } from "@/lib/types";

// Pure derivation for the subgraph status pill's job-state view. Kept apart
// from `live-status.tsx` so the selection/labelling rules are unit-testable
// without rendering — the component is the shell, this is the logic.

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
