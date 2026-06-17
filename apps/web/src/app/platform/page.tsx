import { EmptyState } from "@/components/console/empty-state";
import { LivePill } from "@/components/console/live-pill";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import {
	badgeClass,
	getDisplayStatus,
	statusLabel,
} from "@/lib/intelligence/subgraphs";
import type { SubgraphSummary } from "@/lib/types";
import Link from "next/link";

function timeAgo(iso?: string | null): string | null {
	if (!iso) return null;
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return null;
	const s = Math.max(0, Math.round((Date.now() - then) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.round(h / 24)}d ago`;
}

function GridIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden="true"
		>
			<rect x="2" y="2" width="5" height="5" rx="1" />
			<rect x="9" y="2" width="5" height="5" rx="1" />
			<rect x="2" y="9" width="5" height="5" rx="1" />
			<rect x="9" y="9" width="5" height="5" rx="1" />
		</svg>
	);
}

export default async function DashboardPage() {
	const session = await getSessionFromCookies();

	let subgraphs: SubgraphSummary[] = [];
	let chainTip: number | null = null;

	if (session) {
		const [subgraphsResult, statusResult] = await Promise.allSettled([
			apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", {
				sessionToken: session,
			}),
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

	const withStatus = subgraphs.map((sg) => ({
		sg,
		ds: getDisplayStatus(sg, chainTip),
	}));
	const counts = { live: 0, syncing: 0, error: 0 };
	for (const { ds } of withStatus) {
		if (ds === "active") counts.live++;
		else if (ds === "error" || ds === "stalled") counts.error++;
		else counts.syncing++;
	}
	const totalRows = subgraphs.reduce(
		(s, sg) => s + (sg.totalRows ?? sg.totalProcessed),
		0,
	);
	const errored = withStatus.filter(
		({ ds }) => ds === "error" || ds === "stalled",
	);

	return (
		<>
			<OverviewTopbar page="Overview" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="dash-head">
						<h1 className="dash-title">Overview</h1>
						<Link className="dash-deploy" href="/docs/subgraphs">
							Deploy subgraph
						</Link>
					</div>

					{subgraphs.length === 0 ? (
						<EmptyState
							icon={<GridIcon />}
							title="Index your first subgraph"
							message="Subgraphs turn on-chain contract activity into live, decoded tables — queryable and yours. Deploy one to light up your dashboard."
							command="sl subgraphs deploy my-view.ts"
							docHref="/docs/subgraphs"
							docLabel="Read the quickstart →"
							ghostRows={5}
						/>
					) : (
						<>
							<div className="dash-fleet">
								<span>
									<b>{subgraphs.length}</b> subgraph
									{subgraphs.length !== 1 ? "s" : ""} · {counts.live} live,{" "}
									{counts.syncing} syncing, {counts.error} error
								</span>
								<span className="sep">·</span>
								<span>
									<b>{totalRows.toLocaleString()}</b> rows indexed
								</span>
								{chainTip != null && (
									<>
										<span className="sep">·</span>
										<span>
											chain tip <b>{chainTip.toLocaleString()}</b>
										</span>
									</>
								)}
							</div>

							{errored.length > 0 && (
								<div className="dash-attn">
									<div className="dash-attn-head">
										<span className="dash-attn-dot" />
										Needs attention
									</div>
									{errored.map(({ sg }) => (
										<div key={sg.name} className="dash-attn-row">
											<span className="dash-attn-dot" />
											<span className="dash-attn-name">{sg.name}</span>
											<span className="dash-attn-msg">
												{sg.lastError || "indexing error"}
												{sg.lastProcessedBlock != null
													? ` · block ${sg.lastProcessedBlock.toLocaleString()}`
													: ""}
												{sg.lastErrorAt ? ` · ${timeAgo(sg.lastErrorAt)}` : ""}
											</span>
											<Link className="dash-btn" href={`/subgraphs/${sg.name}`}>
												Inspect
											</Link>
										</div>
									))}
								</div>
							)}

							<div className="dash-sec">
								<div className="dash-sec-head">
									<span className="t">
										Subgraphs<span className="cnt">{subgraphs.length}</span>
									</span>
									<Link className="ov-section-link" href="/platform/subgraphs">
										Manage &rarr;
									</Link>
								</div>
								<div className="dash-led">
									{withStatus.map(({ sg }) => (
										<Link
											key={sg.name}
											href={`/subgraphs/${sg.name}`}
											className="dash-led-row"
										>
											<span className="dash-led-name">
												{sg.name}
												<span className="dash-led-ver">v{sg.version}</span>
											</span>
											<span className={`badge ${badgeClass(sg, chainTip)}`}>
												{statusLabel(sg, chainTip)}
											</span>
											<span className="dash-led-num">
												{(sg.totalRows ?? sg.totalProcessed).toLocaleString()}{" "}
												rows
											</span>
											<span className="dash-led-num">
												{sg.lastProcessedBlock != null
													? `#${sg.lastProcessedBlock.toLocaleString()}`
													: "—"}
											</span>
											<span
												className={`dash-led-vis${sg.visibility === "public" ? " pub" : ""}`}
											>
												{sg.visibility === "public" ? "Public" : "Private"}
											</span>
										</Link>
									))}
								</div>
							</div>
						</>
					)}
				</div>
			</div>

			{subgraphs.length > 0 && (
				<LivePill state="live" label="Live">
					<div className="lp-h">
						<span className="lp-dot green" />
						<b>Project</b> · Live
					</div>
					<div className="lp-stat">
						<span className="k">Subgraphs</span>
						<span className="v">{subgraphs.length}</span>
					</div>
					<div className="lp-stat">
						<span className="k">Rows indexed</span>
						<span className="v">{totalRows.toLocaleString()}</span>
					</div>
					{chainTip != null && (
						<div className="lp-stat">
							<span className="k">Chain tip</span>
							<span className="v">{chainTip.toLocaleString()}</span>
						</div>
					)}
				</LivePill>
			)}
		</>
	);
}
