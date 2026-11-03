import { SubgraphDetailSection } from "@/components/account/subgraphs/detail-screen";
import { subgraphDetailReads } from "@/lib/server/dashboard-reads";
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
}: {
	params: Promise<{ name: string }>;
}) {
	const name = decode((await params).name);
	const token = await sessionToken();
	const initial = token ? await subgraphDetailReads(token, name) : null;
	return <SubgraphDetailSection name={name} initial={initial} />;
}
