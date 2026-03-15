import type { ViewSummary, ViewDetail } from "@/lib/types";

// ── V1 — Stalled View ───────────────────────────────────────────────

export interface StalledView {
  blocksBehind: number;
  lastProcessedBlock: number;
  chainTip: number;
}

export function detectStalledView(
  view: ViewSummary | ViewDetail,
  chainTip: number,
): StalledView | null {
  if (view.status === "error" || view.status === "reindexing") return null;
  if (view.lastProcessedBlock == null) return null;

  const blocksBehind = chainTip - view.lastProcessedBlock;
  if (blocksBehind <= 50) return null;

  return { blocksBehind, lastProcessedBlock: view.lastProcessedBlock, chainTip };
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
  health: ViewDetail["health"],
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
