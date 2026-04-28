import { OnboardingCard } from "@/components/console/onboarding-card";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { getSessionFromCookies } from "@/lib/api";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type { SubgraphSummary, SubscriptionSummary } from "@/lib/types";
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

function dotColor(status: string) {
	if (status === "active") return "green";
	if (status === "syncing" || status === "reindexing") return "yellow";
	if (status === "error" || status === "failed") return "red";
	if (status === "paused") return "yellow";
	return "muted";
}

function formatRows(n: number) {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toLocaleString();
}

export default async function DashboardPage() {
	const session = await getSessionFromCookies();

	let subgraphs: SubgraphSummary[] = [];
	let subscriptions: SubscriptionSummary[] = [];

	if (session) {
		const [subgraphsResult, subscriptionsResult] = await Promise.allSettled([
			fetchFromTenantOrThrow<{ data: SubgraphSummary[] }>(
				session,
				"/api/subgraphs",
			),
			fetchFromTenantOrThrow<{ data: SubscriptionSummary[] }>(
				session,
				"/api/subscriptions",
			),
		]);
		subgraphs =
			subgraphsResult.status === "fulfilled" ? subgraphsResult.value.data : [];
		subscriptions =
			subscriptionsResult.status === "fulfilled"
				? subscriptionsResult.value.data
				: [];
	}

	const totalRows = subgraphs.reduce(
		(s, sg) => s + (sg.totalRows ?? sg.totalProcessed),
		0,
	);
	const totalProcessed = subgraphs.reduce((s, sg) => s + sg.totalProcessed, 0);
	const totalErrors = subgraphs.reduce((s, sg) => s + sg.totalErrors, 0);
	const uptime =
		totalProcessed > 0
			? ((totalProcessed - totalErrors) / totalProcessed) * 100
			: null;

	const healthySubgraphs = subgraphs.filter(
		(s) => s.status !== "error" && s.status !== "failed",
	).length;
	const activeSubscriptions = subscriptions.filter(
		(s) => s.status === "active",
	).length;

	return (
		<>
			<OverviewTopbar page="Overview" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<OnboardingCard />
				<div className="overview-inner">
					<div className="ov-stats-label">
						Overview
						<InfoTip text="Key metrics across your project" />
					</div>

					<div className="ov-stats-grid">
						<Link href="/platform/subgraphs" className="ov-card">
							<div className="ov-card-label">
								Active Subgraphs <InfoTip text="Number of deployed subgraphs" />
							</div>
							<div className="ov-card-value">{subgraphs.length}</div>
							<div className="ov-card-sub">
								{subgraphs.length > 0 ? (
									<span
										className={`ov-stat-sub-pill ${healthySubgraphs === subgraphs.length ? "green" : "yellow"}`}
									>
										<span
											style={{
												width: 4,
												height: 4,
												borderRadius: "50%",
												background: "currentColor",
												display: "inline-block",
											}}
										/>
										{healthySubgraphs === subgraphs.length
											? "All healthy"
											: `${healthySubgraphs} healthy`}
									</span>
								) : (
									"no subgraphs"
								)}
							</div>
						</Link>

						<Link href="/platform/subgraphs" className="ov-card">
							<div className="ov-card-label">
								Rows Indexed{" "}
								<InfoTip text="Total rows stored across all subgraph tables" />
							</div>
							<div className="ov-card-value">{formatRows(totalRows)}</div>
							<div className="ov-card-sub">across all subgraphs</div>
						</Link>

						<div className="ov-card">
							<div className="ov-card-label">
								Subscriptions <InfoTip text="Webhook and event subscriptions" />
							</div>
							<div className="ov-card-value">{subscriptions.length}</div>
							<div className="ov-card-sub">
								{subscriptions.length > 0
									? `${activeSubscriptions} active`
									: "no subscriptions"}
							</div>
						</div>

						<Link href="/platform/subgraphs" className="ov-card">
							<div className="ov-card-label">
								Uptime{" "}
								<InfoTip text="Percentage of blocks processed without error" />
							</div>
							<div
								className="ov-card-value"
								style={{
									color:
										uptime === null
											? undefined
											: uptime >= 99
												? "var(--accent)"
												: uptime >= 95
													? "var(--yellow)"
													: "var(--red)",
								}}
							>
								{uptime !== null ? `${uptime.toFixed(1)}%` : "—"}
							</div>
							<div className="ov-card-sub">across all subgraphs</div>
						</Link>
					</div>

					{/* Subgraphs */}
					<div className="ov-act-section">
						<div className="ov-act-header">
							<span className="ov-act-title">Subgraphs</span>
							<Link href="/platform/subgraphs" className="ov-section-link">
								View all &rarr;
							</Link>
						</div>
						{subgraphs.length > 0 ? (
							<div className="ov-act-list">
								{subgraphs.slice(0, 5).map((sg) => (
									<Link
										key={sg.name}
										href={`/platform/subgraphs/${sg.name}`}
										className="ov-act-item"
									>
										<span className={`ov-act-dot ${dotColor(sg.status)}`} />
										<div className="ov-act-content">
											<div className="ov-act-name">
												<code>{sg.name}</code>
											</div>
											<div className="ov-act-meta">
												v{sg.version} &middot;{" "}
												{formatRows(sg.totalRows ?? sg.totalProcessed)} rows
											</div>
										</div>
										<span className={`ov-act-badge ${sg.status}`}>
											{sg.status}
										</span>
									</Link>
								))}
							</div>
						) : (
							<div className="ov-empty">
								No subgraphs yet.{" "}
								<Link href="/platform/subgraphs" className="ov-section-link">
									Deploy one &rarr;
								</Link>
							</div>
						)}
					</div>

					{/* Subscriptions */}
					<div className="ov-act-section">
						<div className="ov-act-header">
							<span className="ov-act-title">Subscriptions</span>
						</div>
						{subscriptions.length > 0 ? (
							<div className="ov-act-list">
								{subscriptions.slice(0, 5).map((sub) => (
									<Link
										key={sub.id}
										href={`/platform/subgraphs/${sub.subgraphName}/subscriptions/${sub.id}`}
										className="ov-act-item"
									>
										<span className={`ov-act-dot ${dotColor(sub.status)}`} />
										<div className="ov-act-content">
											<div className="ov-act-name">
												<code>{sub.name}</code>
											</div>
											<div className="ov-act-meta">
												{sub.subgraphName} &middot; {sub.format}
												{sub.lastDeliveryAt &&
													` · last delivery ${formatRelative(sub.lastDeliveryAt)}`}
											</div>
										</div>
										<span className={`ov-act-badge ${sub.status}`}>
											{sub.status}
										</span>
									</Link>
								))}
							</div>
						) : (
							<div className="ov-empty">
								No subscriptions yet.{" "}
								<Link
									href="https://docs.secondlayer.dev/subscriptions"
									className="ov-section-link"
									target="_blank"
									rel="noopener noreferrer"
								>
									Learn more &rarr;
								</Link>
							</div>
						)}
					</div>
				</div>
			</div>
		</>
	);
}
