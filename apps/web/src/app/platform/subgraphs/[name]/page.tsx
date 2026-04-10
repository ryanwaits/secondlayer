import { BreadcrumbDropdown } from "@/components/console/breadcrumb-dropdown";
import { DetailCodeBlock } from "@/components/console/detail-code-block";
import { DetailSection } from "@/components/console/detail-section";
import { MetaGrid } from "@/components/console/meta-grid";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, apiRequest, getSessionFromCookies } from "@/lib/api";
import { getDisplayStatus } from "@/lib/intelligence/subgraphs";
import type { ApiKey, SubgraphDetail, SubgraphSummary } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubgraphDataBrowser } from "./data-browser";
import { SubgraphReindexForm } from "./reindex-form";
import { SubgraphUrlSection } from "./url-section";

function statusBadgeClass(status: string) {
	if (status === "active") return "active";
	if (status === "syncing" || status === "reindexing") return "syncing";
	return "error";
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
		const [sgResult, listResult] = await Promise.allSettled([
			apiRequest<SubgraphDetail>(`/api/subgraphs/${name}`, {
				sessionToken: session ?? undefined,
				tags: ["subgraphs", `subgraph-${name}`],
			}),
			apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", {
				sessionToken: session ?? undefined,
				tags: ["subgraphs"],
			}),
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

	const keysResult = await apiRequest<{ keys: ApiKey[] }>("/api/keys", {
		sessionToken: session ?? undefined,
		tags: ["keys"],
	}).catch(() => ({ keys: [] as ApiKey[] }));

	const primaryKey = keysResult.keys
		.filter((k) => k.status === "active")
		.sort((a, b) => {
			if (a.lastUsedAt && b.lastUsedAt)
				return (
					new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
				);
			if (a.lastUsedAt) return -1;
			if (b.lastUsedAt) return 1;
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
		})[0];

	const tableEntries = Object.entries(subgraph.tables);
	const totalRows = tableEntries.reduce((sum, [, t]) => sum + t.rowCount, 0);
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
			? `${(((totalProcessed - totalErrors) / totalProcessed) * 100).toFixed(1)}%`
			: "—";

	const { blocksRemaining } = subgraph.sync;
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
				version={subgraph.version}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* Metadata cards */}
					<MetaGrid
						items={[
							{
								label: "Base URL",
								value: "https://api.secondlayer.tools/api/subgraphs",
								mono: true,
								tooltip: "Base URL for all REST queries against this subgraph",
								copyValue: "https://api.secondlayer.tools/api/subgraphs",
								span: 2,
							},
							{
								label: "Status",
								value: (
									<span className={`badge ${statusBadgeClass(displayStatus)}`}>
										{displayStatus}
									</span>
								),
								tooltip: "Current indexing state of this subgraph",
							},
							{
								label: "Last Indexed Block",
								value: subgraph.lastProcessedBlock
									? `#${subgraph.lastProcessedBlock.toLocaleString()}`
									: "—",
								mono: true,
								tooltip:
									"Most recent block processed by this subgraph. May lag behind chain tip while catching up.",
							},
							{
								label: "Total Rows",
								value: totalRows.toLocaleString(),
								tooltip: "Total records across all tables in this subgraph",
							},
							{
								label: "Latency",
								value: latency,
								tooltip:
									"Estimated time behind chain tip, based on blocks remaining × ~10s avg block time",
							},
							{
								label: "Uptime",
								value: uptime,
								tooltip:
									"Percentage of blocks processed without error — (processed − errors) / processed",
							},
						]}
					/>

					<SubgraphUrlSection
						tables={subgraph.tables}
						apiKeyPrefix={primaryKey?.prefix}
					/>

					{/* Schema */}
					<DetailSection title="Schema">
						{tableEntries.map(([tableName, table]) => (
							<div key={tableName} className="sg-schema-table">
								<div className="sg-schema-name">
									{tableName}{" "}
									<span className="row-count">
										{table.rowCount.toLocaleString()} rows
									</span>
								</div>
								<table className="sg-table">
									<thead>
										<tr>
											<th>Column</th>
											<th>Type</th>
											<th>Attributes</th>
										</tr>
									</thead>
									<tbody>
										{Object.entries(table.columns).map(([colName, col]) => (
											<tr key={colName}>
												<td>
													<span className="mono">{colName}</span>
												</td>
												<td>
													<span className="mono">{col.type}</span>
												</td>
												<td>
													{colName.startsWith("_") && (
														<span className="sg-col-badge">system</span>
													)}{" "}
													{col.indexed && (
														<span className="sg-col-badge indexed">
															indexed
														</span>
													)}{" "}
													{col.searchable && (
														<span className="sg-col-badge searchable">
															searchable
														</span>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						))}
					</DetailSection>

					{/* Data Browser */}
					{tableEntries.length > 0 && (
						<DetailSection title="Data">
							<SubgraphDataBrowser
								subgraphName={name}
								tables={Object.keys(subgraph.tables)}
								sessionToken={session ?? ""}
							/>
						</DetailSection>
					)}

					{/* Backfill / Reindex */}
					<DetailSection title="Backfill &amp; Reindex">
						<SubgraphReindexForm
							subgraphName={name}
							sessionToken={session ?? ""}
						/>
					</DetailSection>
				</div>
			</div>
		</>
	);
}
