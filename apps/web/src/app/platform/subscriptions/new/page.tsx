import { OverviewTopbar } from "@/components/console/overview-topbar";
import { getSessionFromCookies } from "@/lib/api";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type { SubgraphSummary } from "@/lib/types";
import { NewSubscriptionForm } from "./form";

export default async function NewSubscriptionPage() {
	const session = await getSessionFromCookies();
	let subgraphs: SubgraphSummary[] = [];
	if (session) {
		try {
			const res = await fetchFromTenantOrThrow<{ data: SubgraphSummary[] }>(
				session,
				"/api/subgraphs",
			);
			subgraphs = res.data;
		} catch {
			subgraphs = [];
		}
	}

	return (
		<>
			<OverviewTopbar page="New subscription" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<NewSubscriptionForm subgraphs={subgraphs} />
				</div>
			</div>
		</>
	);
}
