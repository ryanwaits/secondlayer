import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import { MarketplaceBrowse } from "./browse";

const toc: TocItem[] = [
	{ label: "DeFi", href: "#defi" },
	{ label: "Stacking", href: "#stacking" },
	{ label: "NFTs", href: "#nfts" },
	{ label: "Identity", href: "#identity" },
	{ label: "Governance", href: "#governance" },
	{ label: "Analytics", href: "#analytics" },
	{ label: "Tokens", href: "#tokens" },
];

export const metadata = {
	title: "Marketplace — secondlayer",
	description: "Explore public subgraphs built by the community",
};

export default function MarketplacePage() {
	return (
		<div className="article-layout">
			<Sidebar title="Marketplace" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">Marketplace</h1>
					<p className="page-date">
						Explore public subgraphs built by the community
					</p>
				</header>

				<MarketplaceBrowse />
			</main>
		</div>
	);
}
