import { IndexRow } from "@/components/console/index-row";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import { getDisplayStatus } from "@/lib/intelligence/subgraphs";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
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
			fetchFromTenantOrThrow<{ data: SubgraphSummary[] }>(
				session,
				"/api/subgraphs",
			),
			apiRequest<{ chainTip: number | null }>("/status", {
				sessionToken: session,
				tags: ["status"],
			}),
		]);
		subgraphs =
			subgraphsResult.status === "fulfilled" ? subgraphsResult.value.data : [];
		chainTip =
			statusResult.status === "fulfilled" ? statusResult.value.chainTip : null;
	}

	return (
		<>
			<OverviewTopbar page="Subgraphs" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{subgraphs.length > 0 && (
						<div className="index-header">
							<div>
								<span className="index-title">Subgraphs</span>
								<span className="index-count">
									{subgraphs.length} subgraph{subgraphs.length !== 1 ? "s" : ""}
								</span>
							</div>
						</div>
					)}

					{subgraphs.length === 0 ? (
						<div className="empty-inner" style={{ padding: "40px 0 0" }}>
							<h1 className="empty-title">No subgraphs yet</h1>
							<p className="empty-desc">
								Subgraphs index on-chain data into queryable tables. Create one
								from your terminal or SDK.
							</p>
							<div className="empty-divider">
								<span className="empty-divider-text">Get started</span>
							</div>
							<div className="empty-cards">
								<div className="empty-card">
									<div className="empty-card-preview">
										<div className="empty-card-preview-art">
											<svg
												width="120"
												height="60"
												viewBox="0 0 120 60"
												fill="none"
												aria-hidden="true"
											>
												<rect
													x="8"
													y="8"
													width="10"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.4"
												/>
												<rect
													x="22"
													y="8"
													width="40"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.2"
												/>
												<rect
													x="8"
													y="18"
													width="10"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.4"
												/>
												<rect
													x="22"
													y="18"
													width="32"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.2"
												/>
												<rect
													x="8"
													y="28"
													width="10"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.4"
												/>
												<rect
													x="22"
													y="28"
													width="50"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.15"
												/>
												<rect
													x="8"
													y="38"
													width="60"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.1"
												/>
											</svg>
										</div>
										<div className="empty-card-icon">
											<svg
												width="18"
												height="18"
												viewBox="0 0 16 16"
												fill="none"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
												aria-hidden="true"
											>
												<path d="M4 5l3 3-3 3" />
												<path d="M9 11h4" />
											</svg>
										</div>
									</div>
									<div className="empty-card-body">
										<div className="empty-card-title">Use the CLI</div>
										<div className="empty-card-desc">
											Run{" "}
											<code
												style={{
													fontSize: 12,
													background: "var(--code-bg)",
													padding: "1px 5px",
													borderRadius: 3,
												}}
											>
												npx secondlayer subgraph create
											</code>{" "}
											to scaffold and deploy a subgraph from your terminal.
										</div>
									</div>
								</div>
								<div className="empty-card">
									<div className="empty-card-preview">
										<div className="empty-card-preview-art">
											<svg
												width="120"
												height="60"
												viewBox="0 0 120 60"
												fill="none"
												aria-hidden="true"
											>
												<rect
													x="8"
													y="8"
													width="14"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.3"
												/>
												<rect
													x="26"
													y="8"
													width="30"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.2"
												/>
												<rect
													x="12"
													y="16"
													width="20"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.25"
												/>
												<rect
													x="36"
													y="16"
													width="16"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.15"
												/>
												<rect
													x="12"
													y="24"
													width="28"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.25"
												/>
												<rect
													x="12"
													y="32"
													width="22"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.2"
												/>
												<rect
													x="8"
													y="40"
													width="10"
													height="4"
													rx="1"
													fill="currentColor"
													opacity="0.3"
												/>
											</svg>
										</div>
										<div className="empty-card-icon">
											<svg
												width="18"
												height="18"
												viewBox="0 0 16 16"
												fill="none"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
												aria-hidden="true"
											>
												<path d="M5 4l-3 4 3 4" />
												<path d="M11 4l3 4-3 4" />
												<path d="M9 2l-2 12" />
											</svg>
										</div>
									</div>
									<div className="empty-card-body">
										<div className="empty-card-title">Use the SDK</div>
										<div className="empty-card-desc">
											Define subgraphs programmatically with the Secondlayer
											SDK. Configure sources, handlers, and schema in
											TypeScript.
										</div>
									</div>
								</div>
							</div>
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
										label: "rows",
										value: `${(sg.totalRows ?? sg.totalProcessed).toLocaleString()} rows`,
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
