import { SubgraphDetailFallback } from "@/components/account/page-fallbacks";
import { Staged } from "@/components/account/staged";
import { SubgraphDetailSection } from "@/components/account/subgraphs/detail-screen";
import { InsightsSeed } from "@/lib/insights-store";
import { subgraphDetailReads } from "@/lib/server/dashboard-reads";
import { readInsights } from "@/lib/server/insights-read";
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

export default function AccountSubgraphDetailPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	return (
		<Staged
			load={loadSubgraphDetail(params)}
			fallback={<SubgraphDetailFallback />}
		>
			{(data) => <SubgraphDetailData {...data} />}
		</Staged>
	);
}

async function loadSubgraphDetail(params: Promise<{ name: string }>) {
	const name = decode((await params).name);
	const token = await sessionToken();
	const [initial, insights] = token
		? await Promise.all([subgraphDetailReads(token, name), readInsights(token)])
		: [null, null];
	return { name, initial, insights };
}

function SubgraphDetailData({
	name,
	initial,
	insights,
}: Awaited<ReturnType<typeof loadSubgraphDetail>>) {
	return (
		<InsightsSeed insights={insights}>
			<SubgraphDetailSection name={name} initial={initial} />
		</InsightsSeed>
	);
}
