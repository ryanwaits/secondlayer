import { DetailTabs } from "@/components/console/detail-tabs";
import { InsightsSection } from "@/components/console/intelligence/insights-section";
import { StalledBanner } from "@/components/console/intelligence/stalled-banner";
import { ApiError, apiRequest, getSessionFromCookies } from "@/lib/api";
import { detectStalledSubgraph } from "@/lib/intelligence/subgraphs";
import type { SubgraphDetail } from "@/lib/types";
import { notFound } from "next/navigation";

export default async function SubgraphDetailLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ name: string }>;
}) {
	const { name } = await params;
	const session = await getSessionFromCookies();

	const [subgraphResult, statusResult] = await Promise.allSettled([
		apiRequest<SubgraphDetail>(`/api/subgraphs/${name}`, {
			sessionToken: session ?? undefined,
			tags: ["subgraphs", `subgraph-${name}`],
		}),
		apiRequest<{ chainTip: number | null }>("/status", {
			sessionToken: session ?? undefined,
			tags: ["status"],
		}),
	]);

	if (subgraphResult.status === "rejected") {
		if (
			subgraphResult.reason instanceof ApiError &&
			subgraphResult.reason.status === 404
		) {
			notFound();
		}
		throw subgraphResult.reason;
	}

	const subgraph = subgraphResult.value;
	const chainTip =
		statusResult.status === "fulfilled" ? statusResult.value.chainTip : null;

	const stalled =
		chainTip != null ? detectStalledSubgraph(subgraph, chainTip) : null;

	const basePath = `/subgraphs/${name}`;
	const tabs = [
		{ label: "Overview", href: basePath },
		{ label: "Schema", href: `${basePath}/schema` },
		{ label: "Data", href: `${basePath}/data` },
		{ label: "Sources", href: `${basePath}/sources` },
		{ label: "Reindex", href: `${basePath}/reindex` },
	];

	return (
		<>
			<div className="dash-page-header">
				<h1 className="dash-page-title">{subgraph.name}</h1>
				<p className="dash-page-desc">
					v{subgraph.version} &middot; {subgraph.status}
				</p>
			</div>

			{stalled && (
				<StalledBanner
					subgraphName={subgraph.name}
					initialBlocksBehind={stalled.blocksBehind}
					initialChainTip={stalled.chainTip}
					initialLastProcessed={stalled.lastProcessedBlock}
				/>
			)}

			{session && (
				<InsightsSection
					category="subgraph"
					resourceId={name}
					sessionToken={session}
				/>
			)}

			<DetailTabs items={tabs} />
			{children}
		</>
	);
}
