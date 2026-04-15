import { CollapsibleSection } from "@/components/console/collapsible-section";
import { OnboardingCard } from "@/components/console/onboarding-card";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { SubgraphSummary, WorkflowSummary } from "@/lib/types";
import Link from "next/link";

function InfoTip({ text }: { text: string }) {
	return (
		<span className="info" title={text}>
			<svg
				width="10"
				height="10"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				aria-label={text}
				role="img"
			>
				<circle cx="8" cy="8" r="6" />
				<path d="M8 7v4" />
				<circle cx="8" cy="5" r="0.5" fill="currentColor" />
			</svg>
		</span>
	);
}

interface RecentSession {
	id: string;
	title: string | null;
	created_at: string;
}

function formatRelative(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 7) return days === 1 ? "yesterday" : `${days}d ago`;
	return new Date(dateStr).toLocaleDateString();
}

function statusClass(status: string) {
	if (status === "active") return "active";
	if (status === "syncing" || status === "reindexing") return "syncing";
	if (status === "error" || status === "failed") return "error";
	return "";
}

export default async function DashboardPage() {
	const session = await getSessionFromCookies();

	let subgraphs: SubgraphSummary[] = [];
	let workflows: WorkflowSummary[] = [];
	let sessions: RecentSession[] = [];

	if (session) {
		const [subgraphsResult, workflowsResult, sessionsResult] =
			await Promise.allSettled([
				apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", {
					sessionToken: session,
					tags: ["subgraphs"],
				}),
				apiRequest<{ workflows: WorkflowSummary[] }>("/api/workflows", {
					sessionToken: session,
					tags: ["workflows"],
				}),
				apiRequest<{ sessions: RecentSession[] }>(
					"/api/chat-sessions?limit=10",
					{ sessionToken: session, tags: ["sessions"] },
				),
			]);
		subgraphs =
			subgraphsResult.status === "fulfilled" ? subgraphsResult.value.data : [];
		workflows =
			workflowsResult.status === "fulfilled"
				? workflowsResult.value.workflows
				: [];
		sessions =
			sessionsResult.status === "fulfilled"
				? sessionsResult.value.sessions
				: [];
	}

	const totalWorkflowRuns = workflows.reduce((s, w) => s + w.totalRuns, 0);

	const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
	const sessionsThisWeek = sessions.filter(
		(s) => new Date(s.created_at).getTime() > weekAgo,
	).length;

	const totalEvents = subgraphs.reduce(
		(s, sg) => s + (sg.totalRows ?? sg.totalProcessed),
		0,
	);
	const totalProcessed = subgraphs.reduce((s, sg) => s + sg.totalProcessed, 0);
	const totalErrors = subgraphs.reduce((s, sg) => s + sg.totalErrors, 0);
	const subgraphUptime =
		totalProcessed > 0
			? ((totalProcessed - totalErrors) / totalProcessed) * 100
			: null;

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
										<div className="ov-card-label">
											Total Subgraphs{" "}
											<InfoTip text="Number of deployed subgraphs" />
										</div>
										<div className="ov-card-value">{subgraphs.length}</div>
										<div className="ov-card-sub">
											{subgraphs.filter((s) => s.status !== "error").length}{" "}
											active
										</div>
									</Link>
									<Link href="/subgraphs" className="ov-card">
										<div className="ov-card-label">
											Rows Indexed{" "}
											<InfoTip text="Total rows stored across all subgraph tables" />
										</div>
										<div className="ov-card-value">
											{totalEvents > 1_000_000
												? `${(totalEvents / 1_000_000).toFixed(1)}M`
												: totalEvents.toLocaleString()}
										</div>
										<div className="ov-card-sub">across all subgraphs</div>
									</Link>
									<Link href="/subgraphs" className="ov-card">
										<div className="ov-card-label">
											Uptime{" "}
											<InfoTip text="Percentage of blocks processed without error across all subgraphs" />
										</div>
										<div
											className="ov-card-value"
											style={{
												color:
													subgraphUptime === null
														? undefined
														: subgraphUptime >= 99
															? "var(--green)"
															: subgraphUptime >= 95
																? "var(--yellow)"
																: "var(--red)",
											}}
										>
											{subgraphUptime !== null
												? `${subgraphUptime.toFixed(1)}%`
												: "—"}
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

					{/* Sessions */}
					<CollapsibleSection title="Sessions" count={sessions.length}>
						{sessions.length > 0 ? (
							<>
								<div className="ov-cards">
									<Link href="/sessions" className="ov-card">
										<div className="ov-card-label">
											Total Sessions{" "}
											<InfoTip text="Number of saved chat sessions" />
										</div>
										<div className="ov-card-value">{sessions.length}</div>
										<div className="ov-card-sub">saved sessions</div>
									</Link>
									<Link href="/sessions" className="ov-card">
										<div className="ov-card-label">
											This Week{" "}
											<InfoTip text="Sessions created in the last 7 days" />
										</div>
										<div className="ov-card-value">{sessionsThisWeek}</div>
										<div className="ov-card-sub">sessions created</div>
									</Link>
								</div>
								<div className="ov-list">
									{sessions.slice(0, 5).map((s) => (
										<Link
											key={s.id}
											href={`/sessions/${s.id}`}
											className="ov-list-item"
										>
											<span className="ov-list-name">
												{s.title || "Untitled session"}
											</span>
											<span className="ov-list-meta">
												{formatRelative(s.created_at)}
											</span>
										</Link>
									))}
								</div>
								<div className="ov-section-footer">
									<Link href="/sessions" className="ov-section-link">
										View all sessions &rarr;
									</Link>
								</div>
							</>
						) : (
							<div className="ov-empty">
								No sessions yet.{" "}
								<Link href="/sessions" className="ov-section-link">
									Start a session &rarr;
								</Link>
							</div>
						)}
					</CollapsibleSection>

					{/* Workflows */}
					<CollapsibleSection title="Workflows" count={workflows.length}>
						{workflows.length > 0 ? (
							<>
								<div className="ov-cards">
									<Link href="/workflows" className="ov-card">
										<div className="ov-card-label">
											Total Workflows{" "}
											<InfoTip text="Number of deployed workflows" />
										</div>
										<div className="ov-card-value">{workflows.length}</div>
										<div className="ov-card-sub">
											{workflows.filter((w) => w.status === "active").length}{" "}
											active
										</div>
									</Link>
									<Link href="/workflows" className="ov-card">
										<div className="ov-card-label">
											Total Runs{" "}
											<InfoTip text="Total workflow executions across all workflows" />
										</div>
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
