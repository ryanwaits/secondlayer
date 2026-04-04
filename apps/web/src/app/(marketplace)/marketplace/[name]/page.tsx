import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import { SubgraphDetail } from "./detail";

const toc: TocItem[] = [
	{ label: "Stats", href: "#stats" },
	{ label: "Query volume", href: "#query-volume" },
	{ label: "Tables", href: "#tables" },
	{ label: "Quick start", href: "#quick-start" },
	{ label: "Details", href: "#details" },
];

export default async function SubgraphDetailPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name } = await params;

	return (
		<div className="article-layout">
			<Sidebar
				title={name}
				toc={toc}
				backHref="/marketplace"
				backLabel="Marketplace"
			/>

			<main className="content-area">
				<div className="page-header" />
				<SubgraphDetail name={name} />
			</main>
		</div>
	);
}
