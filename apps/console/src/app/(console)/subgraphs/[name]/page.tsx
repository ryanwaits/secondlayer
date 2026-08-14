import { EmptyState } from "@/components/console/empty-state";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, INSTANCE_API_URL, apiRequest } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { getDisplayStatus } from "@/lib/intelligence/subgraphs";
import type { SubgraphDetail, SubscriptionSummary } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubgraphLiveStatus } from "./live-status";
import { SubgraphReindexForm } from "./reindex-form";
import { SubgraphDangerZone } from "./subgraph-danger";

function subBadge(status: string): string {
	if (status === "active") return "active";
	if (status === "paused") return "syncing";
	return "error";
}

export default async function SubgraphDetailPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name } = await params;

	const [sgResult] = await Promise.allSettled([
		apiRequest<SubgraphDetail>(`/api/subgraphs/${encodeURIComponent(name)}`),
	]);

	if (sgResult.status === "rejected") {
		if (sgResult.reason instanceof ApiError && sgResult.reason.status === 404)
			notFound();
		throw sgResult.reason;
	}
	const subgraph: SubgraphDetail = sgResult.value;

	let subsForSubgraph: SubscriptionSummary[] = [];
	try {
		const subsResult = await apiRequest<{ data: SubscriptionSummary[] }>(
			"/api/subscriptions",
		);
		subsForSubgraph = subsResult.data.filter((s) => s.subgraphName === name);
	} catch {
		subsForSubgraph = [];
	}
	const subsCount = subsForSubgraph.length;
	const activeCount = subsForSubgraph.filter(
		(s) => s.status === "active",
	).length;

	const tableEntries = Object.entries(subgraph.tables);
	const displayStatus = getDisplayStatus(
		{
			...subgraph,
			totalProcessed: subgraph.health.totalProcessed,
			totalErrors: subgraph.health.totalErrors,
			tables: Object.keys(subgraph.tables),
			createdAt: "",
		},
		subgraph.lastProcessedBlock,
	);

	const isError = displayStatus === "error" || displayStatus === "stalled";
	const inProgress =
		displayStatus === "syncing" || displayStatus === "reindexing";
	const badgeCls = isError ? "error" : inProgress ? "syncing" : "active";
	const badgeLbl = isError
		? "Error"
		: displayStatus === "reindexing"
			? "Reindexing"
			: displayStatus === "syncing"
				? "Syncing"
				: "Live";

	return (
		<>
			<OverviewTopbar
				crumbs={[{ label: "subgraphs", href: "/subgraphs" }, { label: name }]}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* Header */}
					<div className="sg-hdr">
						<div className="sg-hdr-identity">
							<span className="sg-hdr-name">{name}</span>
							<span className="sg-hdr-version">v{subgraph.version}</span>
							<span className={`badge ${badgeCls}`}>{badgeLbl}</span>
						</div>
						<div className="sg-hdr-actions" />
					</div>

					{/* Endpoint bar */}
					<div className="sg-ep">
						<span className="sg-ep-method">GET</span>
						<span className="sg-ep-url">
							{INSTANCE_API_URL}/api/subgraphs/{name}/
							<span className="hl">{"<table>"}</span>
						</span>
						<a
							href="https://www.secondlayer.tools/docs/rest-api"
							className="sg-ep-link"
							target="_blank"
							rel="noopener noreferrer"
						>
							API docs →
						</a>
					</div>

					{/* Tables */}
					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">
								Tables<span className="cnt">{tableEntries.length}</span>
							</span>
						</div>
						{tableEntries.length > 0 ? (
							<div className="sg-tl-grid">
								{tableEntries.map(([tName, tInfo]) => {
									const cols = Object.entries(tInfo.columns);
									return (
										<Link
											key={tName}
											href={`/subgraphs/${name}/${tName}`}
											className="sg-tl-card"
										>
											<div className="sg-tl-header">
												<span className="sg-tl-name">{tName}</span>
												<div className="sg-tl-stats">
													<span className="sg-tl-stat">
														<strong>{tInfo.rowCount.toLocaleString()}</strong>{" "}
														rows
													</span>
													<span className="sg-tl-stat">
														<strong>{cols.length}</strong> cols
													</span>
												</div>
											</div>
											<div className="sg-tl-chips">
												{cols.map(([colName, col]) => (
													<span
														key={colName}
														className={`sg-tl-chip${col.indexed ? " idx" : ""}${colName.startsWith("_") ? " sys" : ""}`}
													>
														{colName}
													</span>
												))}
											</div>
										</Link>
									);
								})}
							</div>
						) : (
							<div className="ov-empty">No tables in this subgraph.</div>
						)}
					</section>

					{/* Subscriptions */}
					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">
								Subscriptions
								<span className="cnt">
									{subsCount}
									{subsCount > 0 ? ` · ${activeCount} active` : ""}
								</span>
							</span>
							{subsCount > 0 && (
								<Link
									href={`/subgraphs/${name}/subscriptions`}
									className="ov-section-link"
								>
									View all &rarr;
								</Link>
							)}
						</div>
						{subsCount === 0 ? (
							<EmptyState
								title="No subscriptions yet"
								message="Subscriptions push new rows to your endpoint as they're indexed — standard webhooks, Inngest, Trigger, or Cloudflare."
								command={`secondlayer subscriptions create <name> --subgraph ${name}`}
								docHref="https://www.secondlayer.tools/docs/subscriptions"
								docLabel="Subscriptions guide →"
								ghostRows={3}
							/>
						) : (
							<div className="sg-subs">
								{subsForSubgraph.map((sub) => (
									<Link
										key={sub.id}
										href={`/subgraphs/${name}/subscriptions/${sub.id}`}
										className="sg-sub-row"
									>
										<div>
											<div className="sg-sub-name">{sub.name}</div>
											<div className="sg-sub-meta">
												{sub.tableName} · {sub.format}
											</div>
										</div>
										<div className="sg-sub-right">
											<span className={`badge ${subBadge(sub.status)}`}>
												{sub.status}
											</span>
											<span className="sg-sub-when">
												{sub.lastDeliveryAt
													? `fired ${timeAgo(sub.lastDeliveryAt)}`
													: "never fired"}
											</span>
										</div>
									</Link>
								))}
							</div>
						)}
					</section>

					{/* Settings */}
					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">Settings</span>
						</div>
						<div className="sg-set-block">
							<div className="sg-set-label">Reindex</div>
							<div className="sg-set-desc">
								Re-derive every table from a block range, or rebuild from
								genesis.
							</div>
							<SubgraphReindexForm subgraphName={name} />
						</div>
					</section>

					{/* Danger zone */}
					<section className="sg-sec">
						<div className="sg-sec-head">
							<span className="t">Danger zone</span>
						</div>
						<div className="sg-danger">
							<SubgraphDangerZone subgraphName={name} />
						</div>
					</section>
				</div>
			</div>

			<SubgraphLiveStatus
				name={name}
				initial={subgraph}
				subsCount={subsCount}
			/>
		</>
	);
}
