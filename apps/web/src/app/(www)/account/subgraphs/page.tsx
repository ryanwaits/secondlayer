import { SubgraphsListSection } from "@/components/account/subgraphs/list-screen";
import { subgraphsListReads } from "@/lib/server/dashboard-reads";
import { sessionToken } from "@/lib/server/session";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

export default async function AccountSubgraphsPage() {
	const token = await sessionToken();
	const initial = token ? await subgraphsListReads(token) : null;
	return <SubgraphsListSection initial={initial} />;
}
