import { BreadcrumbDropdown } from "@/components/console/breadcrumb-dropdown";
import { CollapsibleSection } from "@/components/console/collapsible-section";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, getSessionFromCookies } from "@/lib/api";
import { getDisplayStatus } from "@/lib/intelligence/subgraphs";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type { SubgraphDetail, SubgraphSummary } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OpenInChat } from "./open-in-chat";

interface SubscriptionSummary {
	id: string;
	name: string;
	status: "active" | "paused" | "error";
	subgraphName: string;
	circuitOpenedAt: string | null;
	lastDeliveryAt: string | null;
}

function dotClass(status: string) {
	if (status === "syncing" || status === "reindexing") return "syncing";
	if (status === "error" || status === "failed") return "error";
	return "";
}

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

export default async function SubgraphDetailPage({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name } = await params;
	const session = await getSessionFromCookies();

	let subgraph: SubgraphDetail;
	let allSubgraphs: SubgraphSummary[] = [];

	try {
		if (!session) notFound();
		const [sgResult, listResult] = await Promise.allSettled([
			fetchFromTenantOrThrow<SubgraphDetail>(session, `/api/subgraphs/${name}`),
			fetchFromTenantOrThrow<{ data: SubgraphSummary[] }>(
				session,
				"/api/subgraphs",
			),
		]);

		if (sgResult.status === "rejected") {
			if (sgResult.reason instanceof ApiError && sgResult.reason.status === 404)
				notFound();
			throw sgResult.reason;
		}
		subgraph = sgResult.value;
		allSubgraphs =
			listResult.status === "fulfilled" ? listResult.value.data : [];
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) notFound();
		throw e;
	}

	let subsForSubgraph: SubscriptionSummary[] = [];
	try {
		const subsResult = await fetchFromTenantOrThrow<{
			data: SubscriptionSummary[];
		}>(session, "/api/subscriptions");
		subsForSubgraph = subsResult.data.filter((s) => s.subgraphName === name);
	} catch {
		subsForSubgraph = [];
	}
	const subsCount = subsForSubgraph.length;
	const activeCount = subsForSubgraph.filter(
		(s) => s.status === "active",
	).length;
	const circuitPausedCount = subsForSubgraph.filter(
		(s) => s.circuitOpenedAt !== null,
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

	const { totalProcessed, totalErrors } = subgraph.health;
	const uptime =
		totalProcessed > 0
			? ((totalProcessed - totalErrors) / totalProcessed) * 100
			: null;

	const { blocksRemaining } = subgraph.sync;
	const chainTip = subgraph.sync.chainTip;
	const syncProgress =
		chainTip && subgraph.lastProcessedBlock
			? Math.min((subgraph.lastProcessedBlock / chainTip) * 100, 100)
			: 0;
	const lagSeconds = blocksRemaining * 10;
	const latency =
		blocksRemaining === 0
			? "synced"
			: lagSeconds >= 600
				? `~${Math.round(lagSeconds / 60)}m`
				: `~${lagSeconds}s`;

	const dropdownItems = allSubgraphs.map((sg) => ({
		name: sg.name,
		href: `/subgraphs/${sg.name}`,
	}));

	return (
		<>
			<OverviewTopbar
				path={
					<Link
						href="/subgraphs"
						style={{ color: "inherit", textDecoration: "none" }}
					>
						Subgraphs
					</Link>
				}
				page={
					<BreadcrumbDropdown
						current={name}
						items={dropdownItems}
						allHref="/subgraphs"
						allLabel="View all subgraphs"
					/>
				}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* Header */}
					<div className="sg-hdr">
						<div className="sg-hdr-identity">
							<div className={`sg-hdr-dot ${dotClass(displayStatus)}`} />
							<span className="sg-hdr-name">{name}</span>
							<span className="sg-hdr-version">v{subgraph.version}</span>
						</div>
						<div className="sg-hdr-actions">
							<Link
								href={`/subgraphs/${name}/subscriptions`}
								className="sg-hdr-btn"
							>
								Subscriptions
							</Link>
							<OpenInChat subgraphName={name} />
						</div>
					</div>

					{/* Endpoint bar */}
					<div className="sg-ep">
						<span className="sg-ep-method">GET</span>
						<span className="sg-ep-url">
							https://api.secondlayer.tools/api/subgraphs/{name}/
							<span className="hl">{"<table>"}</span>
						</span>
						<a
							href="https://docs.secondlayer.dev/api"
							className="sg-ep-link"
							target="_blank"
							rel="noopener noreferrer"
						>
							API docs →
						</a>
					</div>

					{/* Overview */}
					<CollapsibleSection title="Overview">
						<div className="sg-cards-grid">
							{/* Uptime */}
							<div className="sg-card">
								<div className="sg-card-label">
									Uptime{" "}
									<InfoTip text="Percentage of blocks processed without error" />
								</div>
								<div className="sg-card-big">
									{uptime !== null ? (
										<>
											{uptime.toFixed(1)}
											<span className="unit">%</span>
										</>
									) : (
										"—"
									)}
								</div>
							</div>

							{/* Block sync */}
							<div className="sg-card">
								<div className="sg-card-label">
									Block sync{" "}
									<InfoTip text="Current indexed block vs chain tip" />
								</div>
								<div className="sg-card-progress">
									<div className="sg-card-bar-wrap">
										<div
											className="sg-card-bar"
											style={{ width: `${syncProgress.toFixed(2)}%` }}
										/>
									</div>
									<div className="sg-card-bar-labels">
										<span className="current">
											{subgraph.lastProcessedBlock
												? `#${subgraph.lastProcessedBlock.toLocaleString()}`
												: "—"}
										</span>
										<span className="tip">
											{chainTip ? `#${chainTip.toLocaleString()}` : "—"}
										</span>
									</div>
								</div>
							</div>

							{/* Latency */}
							<div className="sg-card">
								<div className="sg-card-label">
									Latency <InfoTip text="Estimated time behind chain tip" />
								</div>
								<div className="sg-card-big neutral">{latency}</div>
								{blocksRemaining > 0 && (
									<div className="sg-card-sub">
										{blocksRemaining.toLocaleString()} blocks behind tip
									</div>
								)}
							</div>

							{/* Tables mini-table */}
							<div className="sg-card">
								<div className="sg-card-label">
									Tables{" "}
									<InfoTip text="Tables and row counts in this subgraph" />
								</div>
								<div className="sg-card-mini-table">
									<div className="sg-card-mini-hdr">
										<span>#</span>
										<span>Name</span>
										<span>Rows</span>
									</div>
									{tableEntries.map(([tName, tInfo], i) => (
										<div key={tName} className="sg-card-mini-row">
											<span className="sg-card-mini-num">{i + 1}</span>
											<span className="sg-card-mini-name">{tName}</span>
											<span className="sg-card-mini-val">
												{tInfo.rowCount.toLocaleString()}
											</span>
										</div>
									))}
								</div>
							</div>
						</div>
					</CollapsibleSection>

					{/* Tables */}
					<CollapsibleSection title="Tables" count={tableEntries.length}>
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
											<div className="sg-tl-arrow">
												<svg
													viewBox="0 0 16 16"
													fill="none"
													stroke="currentColor"
													strokeWidth="1.5"
													strokeLinecap="round"
													aria-hidden="true"
												>
													<path d="M3 8h10M9 4l4 4-4 4" />
												</svg>
												Open table
											</div>
										</Link>
									);
								})}
							</div>
						) : (
							<div className="ov-empty">No tables in this subgraph.</div>
						)}
					</CollapsibleSection>

					{/* Subscriptions */}
					<CollapsibleSection title="Subscriptions" count={subsCount}>
						{subsCount === 0 ? (
							<div className="ov-empty">
								No subscriptions attached to this subgraph.{" "}
								<Link
									href={`/subgraphs/${name}/subscriptions`}
									className="ov-section-link"
								>
									Create one →
								</Link>
							</div>
						) : (
							<p style={{ fontSize: 13, color: "var(--text-muted)" }}>
								<Link href={`/subgraphs/${name}/subscriptions`}>
									{subsCount} subscription{subsCount !== 1 ? "s" : ""}
								</Link>{" "}
								· {activeCount} active · {circuitPausedCount} circuit-paused
							</p>
						)}
					</CollapsibleSection>
				</div>
			</div>
		</>
	);
}
