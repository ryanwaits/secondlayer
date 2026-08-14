import { EmptyState } from "@/components/console/empty-state";
import { LivePill } from "@/components/console/live-pill";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import {
	badgeClass,
	getDisplayStatus,
	statusLabel,
} from "@/lib/intelligence/subgraphs";
import type {
	InstanceSummary,
	SubgraphSummary,
	SystemStatus,
} from "@/lib/types";
import Link from "next/link";

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

export default async function OverviewPage() {
	const [subgraphsResult, statusResult, instanceResult] =
		await Promise.allSettled([
			apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs"),
			apiRequest<SystemStatus>("/status"),
			apiRequest<InstanceSummary>("/v1/instance"),
		]);
	const subgraphs =
		subgraphsResult.status === "fulfilled" ? subgraphsResult.value.data : [];
	const chainTip =
		statusResult.status === "fulfilled" ? statusResult.value.chainTip : null;
	const instance =
		instanceResult.status === "fulfilled" ? instanceResult.value : null;
	const unreachable =
		subgraphsResult.status === "rejected" &&
		instanceResult.status === "rejected";

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

	// Honest fleet observability (no fabricated uptime): decode success rate
	// from real processed/error counts, and how far the furthest-behind
	// subgraph trails.
	const totalProcessed = subgraphs.reduce((s, sg) => s + sg.totalProcessed, 0);
	const totalErrors = subgraphs.reduce((s, sg) => s + sg.totalErrors, 0);
	const successRate =
		totalProcessed > 0
			? ((totalProcessed - totalErrors) / totalProcessed) * 100
			: null;
	const successDisplay =
		successRate === null
			? "—"
			: totalErrors === 0
				? "100%"
				: `${successRate.toFixed(2)}%`;
	const processedBlocks = subgraphs
		.map((s) => s.lastProcessedBlock)
		.filter((b): b is number => b != null);
	const behind =
		chainTip != null && processedBlocks.length > 0
			? Math.max(0, chainTip - Math.min(...processedBlocks))
			: null;

	return (
		<>
			<OverviewTopbar page="Overview" />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<div className="dash-head">
						<h1 className="dash-title">This instance</h1>
					</div>

					{/* Identity strip — /v1/instance, not a session. */}
					<div className="ident">
						<span className="kv">
							network <b>{instance?.network ?? "—"}</b>
						</span>
						<span className="kv">
							mode <b>{instance?.mode ?? "—"}</b>
						</span>
						{chainTip != null && (
							<span className="kv">
								tip <b>#{chainTip.toLocaleString()}</b>
							</span>
						)}
					</div>

					{unreachable ? (
						<EmptyState message="Instance unreachable — is the runtime up and SL_API_URL pointed at it?" />
					) : subgraphs.length === 0 ? (
						<EmptyState
							icon={<GridIcon />}
							title="Index your first subgraph"
							message="Subgraphs turn on-chain contract activity into live, decoded tables — queryable and yours. Deploy one to light up this instance."
							command="secondlayer subgraphs deploy my-view.ts"
							docHref="https://www.secondlayer.tools/docs/subgraphs"
							docLabel="Read the quickstart →"
							ghostRows={5}
						/>
					) : (
						<>
							<div className="ov-cards">
								<Link className="ov-card" href="/subgraphs">
									<div className="ov-card-label">
										<span className="ov-card-dot" />
										Indexing health
									</div>
									<div
										className={`ov-card-value${totalErrors === 0 && successRate !== null ? " ok" : ""}`}
									>
										{successDisplay}
									</div>
									<div className="ov-card-sub">
										<span className="live">
											{counts.live}/{subgraphs.length} live
										</span>{" "}
										· {totalErrors.toLocaleString()} decode error
										{totalErrors !== 1 ? "s" : ""}
									</div>
								</Link>
								<Link className="ov-card" href="/subgraphs">
									<div className="ov-card-label">Rows indexed</div>
									<div className="ov-card-value">
										{totalRows.toLocaleString()}
									</div>
									<div className="ov-card-sub">
										across {subgraphs.length} subgraph
										{subgraphs.length !== 1 ? "s" : ""}
									</div>
								</Link>
								<Link className="ov-card" href="/subgraphs">
									<div className="ov-card-label">Behind tip</div>
									<div className="ov-card-value">
										{behind === null ? (
											"—"
										) : behind === 0 ? (
											"At tip"
										) : (
											<>
												{behind.toLocaleString()}
												<span className="unit">blocks</span>
											</>
										)}
									</div>
									<div className="ov-card-sub">
										{chainTip != null
											? `tip ${chainTip.toLocaleString()}${behind && behind > 0 ? " · catching up" : ""}`
											: "chain tip unavailable"}
									</div>
								</Link>
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
									<Link className="ov-section-link" href="/subgraphs">
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
						<b>{instance?.network ?? "Instance"}</b> · Live
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
