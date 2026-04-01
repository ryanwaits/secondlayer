import { ApiError, apiRequest, getSessionFromCookies } from "@/lib/api";
import type { SubgraphDetail } from "@/lib/types";
import { notFound } from "next/navigation";
import { DataClient } from "./data-client";

export default async function SubgraphDataPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name } = await params;
	const session = await getSessionFromCookies();

	let subgraph: SubgraphDetail;
	try {
		subgraph = await apiRequest<SubgraphDetail>(`/api/subgraphs/${name}`, {
			sessionToken: session ?? undefined,
			tags: ["subgraphs", `subgraph-${name}`],
		});
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) notFound();
		throw e;
	}

	const tables = Object.keys(subgraph.tables);
	const initialTable = tables[0] ?? "";

	// Fetch page 0 of the first table server-side
	let initialData = null;
	if (initialTable) {
		try {
			initialData = await apiRequest<{
				data: Record<string, unknown>[];
				meta: { total: number; limit: number; offset: number };
			}>(
				`/api/subgraphs/${name}/${initialTable}?_limit=20&_offset=0&_sort=_id&_order=desc`,
				{
					sessionToken: session ?? undefined,
				},
			);
		} catch {
			// Non-critical — client will fetch on mount
		}
	}

	return (
		<DataClient
			subgraphName={name}
			tables={tables}
			initialTable={initialTable}
			initialData={initialData}
		/>
	);
}
