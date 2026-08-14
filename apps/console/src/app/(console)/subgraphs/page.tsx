import { EmptyState } from "@/components/console/empty-state";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { SubgraphsIndex } from "@/components/console/subgraphs-index";
import { apiRequest } from "@/lib/api";
import type { SubgraphSummary, SystemStatus } from "@/lib/types";

export default async function SubgraphsPage() {
	const [subgraphsResult, statusResult] = await Promise.allSettled([
		apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs"),
		apiRequest<SystemStatus>("/status"),
	]);
	const subgraphs =
		subgraphsResult.status === "fulfilled" ? subgraphsResult.value.data : [];
	const chainTip =
		statusResult.status === "fulfilled" ? statusResult.value.chainTip : null;

	return (
		<>
			<OverviewTopbar page="Subgraphs" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{subgraphs.length === 0 ? (
						<EmptyState
							title="No subgraphs yet"
							message="Subgraphs index on-chain data into queryable tables on this instance. Scaffold one from a contract, review the handlers, then deploy."
							command="secondlayer subgraphs scaffold SP123.contract --output subgraphs/my-subgraph.ts"
							docHref="https://www.secondlayer.tools/docs/subgraphs"
							docLabel="Read the quickstart →"
							ghostRows={5}
						/>
					) : (
						<SubgraphsIndex subgraphs={subgraphs} chainTip={chainTip} />
					)}
				</div>
			</div>
		</>
	);
}
