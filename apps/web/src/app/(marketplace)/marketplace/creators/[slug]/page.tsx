import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import { CreatorDetail } from "./creator";

const toc: TocItem[] = [
	{ label: "Subgraphs", href: "#subgraphs" },
];

export default async function CreatorPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;

	return (
		<div className="article-layout">
			<Sidebar
				title={`@${slug}`}
				toc={toc}
				backHref="/marketplace"
				backLabel="Marketplace"
			/>

			<main className="content-area">
				<CreatorDetail slug={slug} />
			</main>
		</div>
	);
}
