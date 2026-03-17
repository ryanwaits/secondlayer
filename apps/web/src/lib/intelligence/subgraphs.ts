import type { SubgraphSummary, SubgraphDetail } from "@/lib/types";

// ── V1 — Stalled Subgraph ──────────────────────────────────────────

export interface StalledSubgraph {
  blocksBehind: number;
  lastProcessedBlock: number;
  chainTip: number;
}

export function detectStalledSubgraph(
  subgraph: SubgraphSummary | SubgraphDetail,
  chainTip: number,
): StalledSubgraph | null {
  if (subgraph.status === "error" || subgraph.status === "reindexing") return null;
  if (subgraph.lastProcessedBlock == null) return null;

  const blocksBehind = chainTip - subgraph.lastProcessedBlock;
  if (blocksBehind <= 50) return null;

  return { blocksBehind, lastProcessedBlock: subgraph.lastProcessedBlock, chainTip };
}

// ── V2 — High Error Rate ────────────────────────────────────────────

export interface HighErrorRate {
  errorRate: number;
  totalProcessed: number;
  totalErrors: number;
  lastError: string | null;
  lastErrorAt: string | null;
  isRecent: boolean;
}

export function detectHighErrorRate(
  health: SubgraphDetail["health"],
): HighErrorRate | null {
  if (health.totalProcessed < 100) return null;
  if (health.errorRate < 0.05) return null;

  const isRecent =
    health.lastErrorAt != null &&
    Date.now() - new Date(health.lastErrorAt).getTime() < 24 * 60 * 60 * 1000;

  return {
    errorRate: health.errorRate,
    totalProcessed: health.totalProcessed,
    totalErrors: health.totalErrors,
    lastError: health.lastError,
    lastErrorAt: health.lastErrorAt,
    isRecent,
  };
}
