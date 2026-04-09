import { CollapsibleSection } from "@/components/console/collapsible-section";
import { OnboardingCard } from "@/components/console/onboarding-card";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { Stream, SubgraphSummary, WorkflowSummary } from "@/lib/types";
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
	let workflows: WorkflowSummary[] = [];

	if (session) {
		const [streamsResult, subgraphsResult, workflowsResult] =
			await Promise.allSettled([
				apiRequest<{ streams: Stream[]; total: number }>(
					"/api/streams?limit=100&offset=0",
					{ sessionToken: session, tags: ["streams"] },
				),
				apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", {
					sessionToken: session,
					tags: ["subgraphs"],
				}),
				apiRequest<{ workflows: WorkflowSummary[] }>("/api/workflows", {
					sessionToken: session,
					tags: ["workflows"],
				}),
			]);
		streams =
			streamsResult.status === "fulfilled" ? streamsResult.value.streams : [];
		subgraphs =
			subgraphsResult.status === "fulfilled" ? subgraphsResult.value.data : [];
		workflows =
			workflowsResult.status === "fulfilled"
				? workflowsResult.value.workflows
				: [];
	}

	const totalWorkflowRuns = workflows.reduce((s, w) => s + w.totalRuns, 0);

	const totalEvents = subgraphs.reduce(
		(s, sg) => s + (sg.totalRows ?? sg.totalProcessed),
		0,
	);
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
					<OnboardingCard />

					{/* Subgraphs */}
					<CollapsibleSection title="Subgraphs" count={subgraphs.length}>
						{subgraphs.length > 0 ? (
							<>
								<div className="ov-cards">
									<Link href="/subgraphs" className="ov-card">
										<div className="ov-card-label">Total Subgraphs</div>
										<div className="ov-card-value">{subgraphs.length}</div>
										<div className="ov-card-sub">
											{subgraphs.filter((s) => s.status !== "error").length}{" "}
											active
										</div>
									</Link>
									<Link href="/subgraphs" className="ov-card">
										<div className="ov-card-label">Rows Indexed</div>
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
											<span
												className={`ov-list-status ${statusClass(sg.status)}`}
											>
												{sg.status}
											</span>
											<span className="ov-list-meta">
												{(sg.totalRows ?? sg.totalProcessed).toLocaleString()}{" "}
												rows
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
										<div className="ov-card-sub">{failedDeliveries} failed</div>
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
											<span
												className={`ov-list-status ${statusClass(st.status)}`}
											>
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

					{/* Workflows */}
					<CollapsibleSection title="Workflows" count={workflows.length}>
						{workflows.length > 0 ? (
							<>
								<div className="ov-cards">
									<Link href="/workflows" className="ov-card">
										<div className="ov-card-label">Total Workflows</div>
										<div className="ov-card-value">{workflows.length}</div>
										<div className="ov-card-sub">
											{workflows.filter((w) => w.status === "active").length}{" "}
											active
										</div>
									</Link>
									<Link href="/workflows" className="ov-card">
										<div className="ov-card-label">Total Runs</div>
										<div className="ov-card-value">
											{totalWorkflowRuns.toLocaleString()}
										</div>
										<div className="ov-card-sub">across all workflows</div>
									</Link>
								</div>
								<div className="ov-list">
									{workflows.slice(0, 5).map((wf) => (
										<Link
											key={wf.name}
											href={`/workflows/${wf.name}`}
											className="ov-list-item"
										>
											<span className="ov-list-name">{wf.name}</span>
											<span
												className={`ov-list-status ${statusClass(wf.status)}`}
											>
												{wf.status}
											</span>
											<span className="ov-list-meta">
												{wf.totalRuns.toLocaleString()} runs
											</span>
										</Link>
									))}
								</div>
								<div className="ov-section-footer">
									<Link href="/workflows" className="ov-section-link">
										View all workflows &rarr;
									</Link>
								</div>
							</>
						) : (
							<div className="ov-empty">
								No workflows deployed yet.{" "}
								<Link href="/workflows" className="ov-section-link">
									Get started &rarr;
								</Link>
							</div>
						)}
					</CollapsibleSection>
				</div>
			</div>
		</>
	);
}
