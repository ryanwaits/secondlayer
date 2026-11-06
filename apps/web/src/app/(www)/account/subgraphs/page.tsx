import { SubgraphsFallback } from "@/components/account/page-fallbacks";
import { SubgraphsListSection } from "@/components/account/subgraphs/list-screen";
import { InsightsSeed } from "@/lib/insights-store";
import { subgraphsListReads } from "@/lib/server/dashboard-reads";
import { savedIndexViews } from "@/lib/server/index-view";
import { readInsights } from "@/lib/server/insights-read";
import { sessionToken } from "@/lib/server/session";
import { Suspense } from "react";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default function AccountSubgraphsPage() {
	return (
		<Suspense fallback={<SubgraphsFallback />}>
			<SubgraphsData />
		</Suspense>
	);
}

async function SubgraphsData() {
	const [token, views] = await Promise.all([sessionToken(), savedIndexViews()]);
	const [initial, insights] = token
		? await Promise.all([subgraphsListReads(token), readInsights(token)])
		: [null, null];
	return (
		<InsightsSeed insights={insights}>
			<SubgraphsListSection
				initial={initial}
				initialView={views.subgraphs ?? "rows"}
			/>
		</InsightsSeed>
	);
}
