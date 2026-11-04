import { SubgraphsListSection } from "@/components/account/subgraphs/list-screen";
import { InsightsSeed } from "@/lib/insights-store";
import { subgraphsListReads } from "@/lib/server/dashboard-reads";
import { readInsights } from "@/lib/server/insights-read";
import { getTiming } from "@/lib/server/render-timing";
import { sessionToken } from "@/lib/server/session";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default async function AccountSubgraphsPage({
	searchParams,
}: {
	searchParams: Promise<{ timing?: string | string[] }>;
}) {
	const timing = getTiming().enableFrom(await searchParams);
	const token = await sessionToken();
	const [initial, insights] = token
		? await timing.step("page:reads", () =>
				Promise.all([subgraphsListReads(token), readInsights(token)]),
			)
		: [null, null];
	const timingScript = await timing.script();
	return (
		<InsightsSeed insights={insights}>
			<SubgraphsListSection initial={initial} />
			{timingScript}
		</InsightsSeed>
	);
}
