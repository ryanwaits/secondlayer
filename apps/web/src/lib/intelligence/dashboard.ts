import type { Stream, SubgraphSummary } from "@/lib/types";
import { detectStalledSubgraph } from "./subgraphs";

export interface AttentionItem {
  stream?: Stream;
  subgraph?: SubgraphSummary;
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

export function triageSubgraphs(
  subgraphs: SubgraphSummary[],
  chainTip: number | null,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const subgraph of subgraphs) {
    if (subgraph.status === "error") {
      items.push({
        subgraph,
        name: subgraph.name,
        href: `/subgraphs/${subgraph.name}`,
        status: "error",
        reason: "Subgraph is in error state",
      });
    } else if (chainTip != null) {
      const stalled = detectStalledSubgraph(subgraph, chainTip);
      if (stalled) {
        items.push({
          subgraph,
          name: subgraph.name,
          href: `/subgraphs/${subgraph.name}`,
          status: "stalled",
          reason: `${stalled.blocksBehind.toLocaleString()} blocks behind`,
        });
      }
    }
  }

  return items;
}
