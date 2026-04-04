"use client";

import { SubgraphCard } from "@/components/marketplace/subgraph-card";
import { SectionHeading } from "@/components/section-heading";
import type { MarketplaceSubgraphSummary } from "@/lib/marketplace-types";
import { useMarketplaceBrowse } from "@/lib/queries/marketplace";

// Category display order + labels
const CATEGORIES: { id: string; label: string }[] = [
	{ id: "defi", label: "DeFi" },
	{ id: "stacking", label: "Stacking" },
	{ id: "nfts", label: "NFTs" },
	{ id: "identity", label: "Identity" },
	{ id: "governance", label: "Governance" },
	{ id: "analytics", label: "Analytics" },
	{ id: "tokens", label: "Tokens" },
];

function groupByCategory(
	subgraphs: MarketplaceSubgraphSummary[],
): { id: string; label: string; items: MarketplaceSubgraphSummary[] }[] {
	const groups: Record<string, MarketplaceSubgraphSummary[]> = {};

	for (const s of subgraphs) {
		// Group by first tag that matches a known category
		const cat = s.tags.find((t) => CATEGORIES.some((c) => c.id === t));
		const key = cat ?? "other";
		if (!groups[key]) groups[key] = [];
		groups[key].push(s);
	}

	return CATEGORIES.filter((c) => groups[c.id]?.length).map((c) => ({
		...c,
		items: groups[c.id],
	}));
}

export function MarketplaceBrowse() {
	const { data, isLoading } = useMarketplaceBrowse({ limit: 100 });
	const subgraphs = data?.data ?? [];
	const sections = groupByCategory(subgraphs);

	if (isLoading) {
		return <div className="mkt-empty">Loading...</div>;
	}

	if (sections.length === 0) {
		return <div className="mkt-empty">No subgraphs found.</div>;
	}

	return (
		<>
			{sections.map((section) => (
				<div key={section.id}>
					<SectionHeading id={section.id}>{section.label}</SectionHeading>
					<div className="mkt-card-list">
						{section.items.map((s) => (
							<SubgraphCard key={s.name} s={s} />
						))}
					</div>
				</div>
			))}
		</>
	);
}
