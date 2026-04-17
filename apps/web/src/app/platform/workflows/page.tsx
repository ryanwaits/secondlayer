import { IndexRow } from "@/components/console/index-row";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import type { WorkflowSummary } from "@/lib/types";

function statusBadgeClass(status: string) {
	if (status === "active") return "active";
	if (status === "paused") return "syncing";
	return "";
}

function formatDate(dateStr: string | null) {
	if (!dateStr) return "—";
	return new Date(dateStr).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

export default async function WorkflowsPage() {
	const session = await getSessionFromCookies();
	let workflows: WorkflowSummary[] = [];

	if (session) {
		try {
			const data = await apiRequest<{ workflows: WorkflowSummary[] }>(
				"/api/workflows",
				{ sessionToken: session, tags: ["workflows"] },
			);
			workflows = data.workflows;
		} catch {}
	}

	return (
		<>
			<OverviewTopbar page="Workflows" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{workflows.length > 0 && (
						<div className="index-header">
							<div>
								<span className="index-title">Workflows</span>
								<span className="index-count">
									{workflows.length} workflow{workflows.length !== 1 ? "s" : ""}
								</span>
							</div>
						</div>
					)}

					{workflows.length === 0 ? (
						<div className="empty-inner" style={{ padding: "40px 0 0" }}>
							<h1 className="empty-title">No workflows yet</h1>
							<p className="empty-desc">
								Workflows automate multi-step tasks that trigger on blockchain
								events, run on a schedule, or fire on demand. Create one from
								your terminal or SDK.
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
												sl workflows deploy workflows/my-workflow.ts
											</code>{" "}
											to deploy a workflow from your terminal.
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
												<circle
													cx="20"
													cy="20"
													r="6"
													fill="currentColor"
													opacity="0.15"
												/>
												<circle
													cx="60"
													cy="30"
													r="6"
													fill="currentColor"
													opacity="0.15"
												/>
												<circle
													cx="100"
													cy="20"
													r="6"
													fill="currentColor"
													opacity="0.15"
												/>
												<path
													d="M26 20 L54 30"
													stroke="currentColor"
													strokeWidth="1"
													opacity="0.2"
												/>
												<path
													d="M66 30 L94 20"
													stroke="currentColor"
													strokeWidth="1"
													opacity="0.2"
												/>
												<rect
													x="8"
													y="42"
													width="104"
													height="4"
													rx="2"
													fill="currentColor"
													opacity="0.08"
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
											Define workflows with{" "}
											<code
												style={{
													fontSize: 12,
													background: "var(--code-bg)",
													padding: "1px 5px",
													borderRadius: 3,
												}}
											>
												@secondlayer/workflows
											</code>
											. Set triggers, steps, and AI analysis in TypeScript.
										</div>
									</div>
								</div>
							</div>
						</div>
					) : (
						workflows.map((wf) => (
							<IndexRow
								key={wf.name}
								href={`/workflows/${wf.name}`}
								name={wf.name}
								badge={
									<span className={`badge ${statusBadgeClass(wf.status)}`}>
										{wf.status}
									</span>
								}
								description={wf.triggerType}
								stats={[
									{
										label: "runs",
										value: `${wf.totalRuns.toLocaleString()} runs`,
									},
									...(wf.lastRunAt
										? [{ label: "last run", value: formatDate(wf.lastRunAt) }]
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
