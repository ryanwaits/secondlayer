import type { SubgraphSummary } from "@/lib/types";
import { detectStalledSubgraph } from "./subgraphs";

export interface AttentionItem {
	subgraph?: SubgraphSummary;
	name: string;
	href: string;
	status: string;
	reason: string;
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
