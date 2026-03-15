import type { Stream, ViewSummary } from "@/lib/types";
import { detectStalledView } from "./views";

export interface AttentionItem {
  stream?: Stream;
  view?: ViewSummary;
  name: string;
  href: string;
  status: string;
  reason: string;
}

export interface TriageResult {
  needsAttention: AttentionItem[];
  allGood: Stream[];
}

export function triageStreams(streams: Stream[]): TriageResult {
  const needsAttention: AttentionItem[] = [];
  const allGood: Stream[] = [];

  for (const stream of streams) {
    if (stream.status === "failed") {
      needsAttention.push({
        stream,
        name: stream.name,
        href: `/streams/${stream.id}`,
        status: "failed",
        reason: stream.errorMessage || "Stream failed due to delivery errors",
      });
    } else if (
      stream.totalDeliveries > 0 &&
      stream.failedDeliveries / stream.totalDeliveries > 0.1
    ) {
      const rate = ((stream.failedDeliveries / stream.totalDeliveries) * 100).toFixed(0);
      needsAttention.push({
        stream,
        name: stream.name,
        href: `/streams/${stream.id}`,
        status: stream.status,
        reason: `${rate}% failure rate`,
      });
    } else if (stream.status === "paused") {
      needsAttention.push({
        stream,
        name: stream.name,
        href: `/streams/${stream.id}`,
        status: "paused",
        reason: "Stream is paused — events are buffered but not delivered",
      });
    } else {
      allGood.push(stream);
    }
  }

  return { needsAttention, allGood };
}

export function triageViews(
  views: ViewSummary[],
  chainTip: number | null,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const view of views) {
    if (view.status === "error") {
      items.push({
        view,
        name: view.name,
        href: `/views/${view.name}`,
        status: "error",
        reason: "View is in error state",
      });
    } else if (chainTip != null) {
      const stalled = detectStalledView(view, chainTip);
      if (stalled) {
        items.push({
          view,
          name: view.name,
          href: `/views/${view.name}`,
          status: "stalled",
          reason: `${stalled.blocksBehind.toLocaleString()} blocks behind`,
        });
      }
    }
  }

  return items;
}
