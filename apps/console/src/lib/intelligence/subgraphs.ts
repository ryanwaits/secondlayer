import type { SubgraphDetail, SubgraphSummary } from "@/lib/types";

// ── Display status — derived from DB status + chain tip ───────────

export type DisplayStatus =
	| "active"
	| "syncing"
	| "stalled"
	| "error"
	| "reindexing";

/**
 * Derive a display status from the DB status and chain tip.
 *  - active: within 50 blocks of tip
 *  - syncing: behind tip but DB status is "active" (catching up)
 *  - stalled: same as syncing but retained for backward compat
 *  - error/reindexing: pass through from DB
 */
export function getDisplayStatus(
	subgraph: SubgraphSummary | SubgraphDetail,
	chainTip: number | null,
): DisplayStatus {
	if (subgraph.status === "error") return "error";
	if (subgraph.status === "reindexing") return "reindexing";
	if (chainTip == null || subgraph.lastProcessedBlock == null) return "active";

	const blocksBehind = chainTip - subgraph.lastProcessedBlock;
	if (blocksBehind <= 50) return "active";
	return "syncing";
}

// Human-facing label per display status. "active" reads as "Live".
const STATUS_LABELS: Record<DisplayStatus, string> = {
	active: "Live",
	syncing: "Syncing",
	stalled: "Syncing",
	error: "Error",
	reindexing: "Reindexing",
};

export function statusLabel(
	subgraph: SubgraphSummary | SubgraphDetail,
	chainTip: number | null,
): string {
	return STATUS_LABELS[getDisplayStatus(subgraph, chainTip)];
}

// CSS modifier on `.badge`. Reindexing is its own class; stalled rolls into error.
export function badgeClass(
	subgraph: SubgraphSummary | SubgraphDetail,
	chainTip: number | null,
): "active" | "syncing" | "reindex" | "error" {
	const s = getDisplayStatus(subgraph, chainTip);
	if (s === "reindexing") return "reindex";
	if (s === "error" || s === "stalled") return "error";
	if (s === "active") return "active";
	return "syncing";
}
