import { CollapsibleSection } from "@/components/console/collapsible-section";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { Stream, SubgraphSummary } from "@/lib/types";
import Link from "next/link";

function statusClass(status: string) {
	if (status === "active") return "active";
	if (status === "syncing" || status === "reindexing") return "syncing";
	if (status === "error" || status === "failed") return "error";
	return "";
}

export default async function DashboardPage() {
	const session = await getSessionFromCookies();

	let streams: Stream[] = [];
	let subgraphs: SubgraphSummary[] = [];

	if (session) {
		const [streamsResult, subgraphsResult] = await Promise.allSettled([
			apiRequest<{ streams: Stream[]; total: number }>(
				"/api/streams?limit=100&offset=0",
				{ sessionToken: session, tags: ["streams"] },
			),
			apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", {
				sessionToken: session,
				tags: ["subgraphs"],
			}),
		]);
		streams =
			streamsResult.status === "fulfilled" ? streamsResult.value.streams : [];
		subgraphs =
			subgraphsResult.status === "fulfilled"
				? subgraphsResult.value.data
				: [];
	}

	const totalEvents = subgraphs.reduce((s, sg) => s + sg.totalProcessed, 0);
	const totalDeliveries = streams.reduce((s, st) => s + st.totalDeliveries, 0);
	const failedDeliveries = streams.reduce(
		(s, st) => s + st.failedDeliveries,
		0,
	);
	const successRate =
		totalDeliveries > 0
			? ((1 - failedDeliveries / totalDeliveries) * 100).toFixed(1)
			: "—";

	return (
		<>
			<OverviewTopbar page="Overview" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* Subgraphs */}
					<CollapsibleSection title="Subgraphs" count={subgraphs.length}>
						{subgraphs.length > 0 ? (
							<>
								<div className="ov-cards">
									<Link href="/subgraphs" className="ov-card">
										<div className="ov-card-label">Total Subgraphs</div>
										<div className="ov-card-value">{subgraphs.length}</div>
										<div className="ov-card-sub">
											{subgraphs.filter((s) => s.status === "active").length} active
										</div>
									</Link>
									<Link href="/subgraphs" className="ov-card">
										<div className="ov-card-label">Events Indexed</div>
										<div className="ov-card-value">
											{totalEvents > 1_000_000
												? `${(totalEvents / 1_000_000).toFixed(1)}M`
												: totalEvents.toLocaleString()}
										</div>
										<div className="ov-card-sub">across all subgraphs</div>
									</Link>
								</div>
								<div className="ov-list">
									{subgraphs.slice(0, 5).map((sg) => (
										<Link
											key={sg.name}
											href={`/subgraphs/${sg.name}`}
											className="ov-list-item"
										>
											<span className="ov-list-name">{sg.name}</span>
											<span className={`ov-list-status ${statusClass(sg.status)}`}>
												{sg.status}
											</span>
											<span className="ov-list-meta">
												{sg.totalProcessed.toLocaleString()} events
											</span>
										</Link>
									))}
								</div>
								<div className="ov-section-footer">
									<Link href="/subgraphs" className="ov-section-link">
										View all subgraphs &rarr;
									</Link>
								</div>
							</>
						) : (
							<div className="ov-empty">
								No subgraphs yet.{" "}
								<Link href="/subgraphs" className="ov-section-link">
									Create one &rarr;
								</Link>
							</div>
						)}
					</CollapsibleSection>

					{/* Streams */}
					<CollapsibleSection title="Streams" count={streams.length}>
						{streams.length > 0 ? (
							<>
								<div className="ov-cards">
									<Link href="/streams" className="ov-card">
										<div className="ov-card-label">Deliveries</div>
										<div className="ov-card-value">
											{totalDeliveries.toLocaleString()}
										</div>
										<div className="ov-card-sub">
											across {streams.length} streams
										</div>
									</Link>
									<Link href="/streams" className="ov-card">
										<div className="ov-card-label">Success Rate</div>
										<div
											className="ov-card-value"
											style={{
												color:
													Number(successRate) >= 99
														? "var(--green)"
														: Number(successRate) >= 95
															? "var(--yellow)"
															: "var(--red)",
											}}
										>
											{successRate}%
										</div>
										<div className="ov-card-sub">
											{failedDeliveries} failed
										</div>
									</Link>
								</div>
								<div className="ov-list">
									{streams.slice(0, 5).map((st) => (
										<Link
											key={st.id}
											href={`/streams/${st.id}`}
											className="ov-list-item"
										>
											<span className="ov-list-name">{st.name}</span>
											<span className={`ov-list-status ${statusClass(st.status)}`}>
												{st.status}
											</span>
											<span className="ov-list-meta">
												{st.totalDeliveries.toLocaleString()} deliveries
											</span>
										</Link>
									))}
								</div>
								<div className="ov-section-footer">
									<Link href="/streams" className="ov-section-link">
										View all streams &rarr;
									</Link>
								</div>
							</>
						) : (
							<div className="ov-empty">
								No streams yet.{" "}
								<Link href="/streams" className="ov-section-link">
									Create one &rarr;
								</Link>
							</div>
						)}
					</CollapsibleSection>

					{/* Sessions */}
					<CollapsibleSection title="Sessions" count={0}>
						<div className="ov-empty">
							No sessions yet.{" "}
							<Link href="/sessions" className="ov-section-link">
								Start a session &rarr;
							</Link>
						</div>
					</CollapsibleSection>

					{/* Agents */}
					<CollapsibleSection title="Agents" count={0}>
						<div className="ov-empty">
							No agents deployed yet.{" "}
							<Link href="/agents" className="ov-section-link">
								Get started &rarr;
							</Link>
						</div>
					</CollapsibleSection>
				</div>
			</div>
		</>
	);
}
