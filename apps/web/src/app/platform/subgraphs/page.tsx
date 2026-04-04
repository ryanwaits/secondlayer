import { IndexRow } from "@/components/console/index-row";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { getDisplayStatus } from "@/lib/intelligence/subgraphs";
import type { SubgraphSummary } from "@/lib/types";
import Link from "next/link";

function statusLabel(sg: SubgraphSummary, chainTip: number | null) {
	const s = getDisplayStatus(sg, chainTip);
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function badgeClass(sg: SubgraphSummary, chainTip: number | null) {
	const s = getDisplayStatus(sg, chainTip);
	if (s === "active") return "active";
	if (s === "syncing" || s === "reindexing") return "syncing";
	if (s === "error" || s === "stalled") return "error";
	return "";
}

export default async function SubgraphsPage() {
	const session = await getSessionFromCookies();
	let subgraphs: SubgraphSummary[] = [];
	let chainTip: number | null = null;

	if (session) {
		const [subgraphsResult, statusResult] = await Promise.allSettled([
			apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", {
				sessionToken: session,
				tags: ["subgraphs"],
			}),
			apiRequest<{ chainTip: number | null }>("/status", {
				sessionToken: session,
				tags: ["status"],
			}),
		]);
		subgraphs =
			subgraphsResult.status === "fulfilled"
				? subgraphsResult.value.data
				: [];
		chainTip =
			statusResult.status === "fulfilled"
				? statusResult.value.chainTip
				: null;
	}

	return (
		<>
			<OverviewTopbar page="Subgraphs" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="index-header">
						<div>
							<span className="index-title">Subgraphs</span>
							<span className="index-count">
								{subgraphs.length} subgraph{subgraphs.length !== 1 ? "s" : ""}
							</span>
						</div>
						<div style={{ display: "flex", gap: 8 }}>
							<Link href="/subgraphs/scaffold" className="index-create-btn">
								<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
									<path d="M6 2v8M2 6h8" />
								</svg>
								New subgraph
							</Link>
						</div>
					</div>

					{subgraphs.length === 0 ? (
						<div className="ov-empty">
							No subgraphs yet.{" "}
							<Link href="/subgraphs/scaffold" className="ov-section-link">
								Create your first subgraph &rarr;
							</Link>
						</div>
					) : (
						subgraphs.map((sg) => (
							<IndexRow
								key={sg.name}
								href={`/subgraphs/${sg.name}`}
								name={sg.name}
								badge={
									<span className={`badge ${badgeClass(sg, chainTip)}`}>
										{statusLabel(sg, chainTip)}
									</span>
								}
								description={
									sg.tables.length > 0
										? `${sg.tables.length} table${sg.tables.length !== 1 ? "s" : ""}`
										: undefined
								}
								stats={[
									{
										label: "events",
										value: `${sg.totalProcessed.toLocaleString()} events`,
									},
									...(sg.lastProcessedBlock != null
										? [
												{
													label: "block",
													value: `#${sg.lastProcessedBlock.toLocaleString()}`,
												},
											]
										: []),
								]}
							/>
						))
					)}
				</div>
			</div>
		</>
	);
}
