import { EmptyState } from "@/components/console/empty-state";
import { LivePill } from "@/components/console/live-pill";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest } from "@/lib/api";
import { compactCount, humanBytes, humanUptime, timeAgo } from "@/lib/format";
import {
	badgeClass,
	getDisplayStatus,
	statusLabel,
} from "@/lib/intelligence/subgraphs";
import type {
	InstanceMetrics,
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
	const [subgraphsResult, statusResult, instanceResult, metricsResult] =
		await Promise.allSettled([
			apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs"),
			apiRequest<SystemStatus>("/status"),
			apiRequest<InstanceSummary>("/v1/instance"),
			apiRequest<InstanceMetrics>("/v1/instance/metrics"),
		]);
	const subgraphs =
		subgraphsResult.status === "fulfilled" ? subgraphsResult.value.data : [];
	const chainTip =
		statusResult.status === "fulfilled" ? statusResult.value.chainTip : null;
	const instance =
		instanceResult.status === "fulfilled" ? instanceResult.value : null;
	const metrics =
		metricsResult.status === "fulfilled" ? metricsResult.value : null;
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
	const lastIndexed =
		processedBlocks.length > 0 ? Math.min(...processedBlocks) : null;
	const behind =
		chainTip != null && lastIndexed != null
			? Math.max(0, chainTip - lastIndexed)
			: null;

	// Rows-processed sparkline — blue-ramp dataviz from real health snapshots.
	// Fewer than 3 points isn't a trend; hide the bar row rather than fake one.
	const series = metrics?.rows_series ?? [];
	const sparkMax = series.reduce((m, p) => Math.max(m, p.rows), 0);
	const showSpark = series.length >= 3 && sparkMax > 0;

	const deliveries = metrics?.deliveries_24h ?? null;

	return (
		<>
			<OverviewTopbar crumbs={[{ label: "overview" }]} />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* H1 + inline identity strip — /v1/instance, not a session. */}
					<div className="ident">
						<h2>This instance</h2>
						{instance?.network && (
							<span className="kv">
								network <b>{instance.network}</b>
							</span>
						)}
						{instance?.mode && (
							<span className="kv">
								mode <b>{instance.mode}</b>
							</span>
						)}
						{metrics != null && (
							<span className="kv">
								uptime <b>{humanUptime(metrics.uptime_s)}</b>
							</span>
						)}
						{metrics?.db_size_bytes != null && (
							<span className="kv">
								postgres <b>{humanBytes(metrics.db_size_bytes)}</b>
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
								<div className="ov-card">
									<div className="ov-card-label">Indexing health</div>
									<div className="ov-card-value">{successDisplay}</div>
									<div className="ov-card-sub">
										{counts.live} live · {counts.syncing} syncing ·{" "}
										{counts.error} error
									</div>
								</div>
								<div className="ov-card">
									<div className="ov-card-label">Rows indexed</div>
									<div className="ov-card-value">{compactCount(totalRows)}</div>
									{showSpark ? (
										<div className="spark" aria-hidden="true">
											{series.map((p) => (
												<i
													key={p.t}
													style={{
														height: `${Math.max(8, Math.round((p.rows / sparkMax) * 100))}%`,
													}}
												/>
											))}
										</div>
									) : (
										<div className="ov-card-sub">
											across {subgraphs.length} subgraph
											{subgraphs.length !== 1 ? "s" : ""}
										</div>
									)}
								</div>
								<div className="ov-card">
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
											? `tip #${chainTip.toLocaleString()}${
													lastIndexed != null
														? ` · last indexed #${lastIndexed.toLocaleString()}`
														: ""
												}`
											: "chain tip unavailable"}
									</div>
								</div>
								{deliveries !== null && (
									<div className="ov-card">
										<div className="ov-card-label">Deliveries · 24h</div>
										<div className="ov-card-value">
											{deliveries.total.toLocaleString()}
										</div>
										<div className="ov-card-sub">
											{deliveries.failed.toLocaleString()} failed ·{" "}
											{deliveries.dlq.toLocaleString()} in DLQ
										</div>
									</div>
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
									<span className="r mono">sl subgraphs create</span>
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
