import { SubgraphDetailSection } from "@/components/account/subgraphs/detail-screen";
import { InsightsSeed } from "@/lib/insights-store";
import { subgraphDetailReads } from "@/lib/server/dashboard-reads";
import { readInsights } from "@/lib/server/insights-read";
import { getTiming } from "@/lib/server/render-timing";
import { sessionToken } from "@/lib/server/session";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

function decode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

export default async function AccountSubgraphDetailPage({
	params,
	searchParams,
}: {
	params: Promise<{ name: string }>;
	searchParams: Promise<{ timing?: string | string[] }>;
}) {
	const name = decode((await params).name);
	const timing = getTiming().enableFrom(await searchParams);
	const token = await sessionToken();
	const [initial, insights] = token
		? await timing.step("page:reads", () =>
				Promise.all([subgraphDetailReads(token, name), readInsights(token)]),
			)
		: [null, null];
	const timingScript = await timing.script();
	return (
		<InsightsSeed insights={insights}>
			<SubgraphDetailSection name={name} initial={initial} />
			{timingScript}
		</InsightsSeed>
	);
}
