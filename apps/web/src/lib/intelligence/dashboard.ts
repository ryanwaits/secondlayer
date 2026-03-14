import type { Stream } from "@/lib/types";

export interface AttentionItem {
  stream: Stream;
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
        reason: stream.errorMessage || "Stream failed due to delivery errors",
      });
    } else if (
      stream.totalDeliveries > 0 &&
      stream.failedDeliveries / stream.totalDeliveries > 0.1
    ) {
      const rate = ((stream.failedDeliveries / stream.totalDeliveries) * 100).toFixed(0);
      needsAttention.push({
        stream,
        reason: `${rate}% failure rate`,
      });
    } else if (stream.status === "paused") {
      needsAttention.push({
        stream,
        reason: "Stream is paused — events are buffered but not delivered",
      });
    } else {
      allGood.push(stream);
    }
  }

  return { needsAttention, allGood };
}
