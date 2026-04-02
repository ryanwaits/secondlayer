import { ApiError, apiRequest, getSessionFromCookies } from "@/lib/api";
import type { SubgraphDetail } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function SubgraphSourcesPage({
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

	const sources = subgraph.sources;

	if (!sources || Object.keys(sources).length === 0) {
		return (
			<>
				<p className="dash-page-desc">
					Source configuration is defined in your subgraph handler code.
				</p>
				<div className="dash-hint" style={{ marginTop: 12 }}>
					<Link
						href="/site/subgraphs"
						style={{ color: "var(--accent-purple)" }}
					>
						Read the docs
					</Link>{" "}
					to learn how to configure data sources.
				</div>
			</>
		);
	}

	return (
		<>
			{Object.entries(sources).map(([sourceName, filter]) => (
				<div key={sourceName} className="source-card">
					<div className="source-contract">
						<span className="source-contract-label">{sourceName}</span>
						{filter.type}
					</div>
					<div className="source-fns">
						{filter.contractId && (
							<span className="source-fn">
								{filter.contractId as string}
							</span>
						)}
						{filter.assetIdentifier && (
							<span className="source-fn">
								{filter.assetIdentifier as string}
							</span>
						)}
						{filter.functionName && (
							<span className="source-fn">
								{filter.functionName as string}
							</span>
						)}
						{filter.topic && (
							<span className="source-fn">
								topic: {filter.topic as string}
							</span>
						)}
						{filter.minAmount && (
							<span className="source-fn">
								min: {String(filter.minAmount)}
							</span>
						)}
					</div>
				</div>
			))}
		</>
	);
}
