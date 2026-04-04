import { BreadcrumbDropdown } from "@/components/console/breadcrumb-dropdown";
import { DetailCodeBlock } from "@/components/console/detail-code-block";
import { DetailSection } from "@/components/console/detail-section";
import { MetaGrid } from "@/components/console/meta-grid";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, apiRequest, getSessionFromCookies } from "@/lib/api";
import { getDisplayStatus } from "@/lib/intelligence/subgraphs";
import type { SubgraphDetail, SubgraphSummary } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubgraphDataBrowser } from "./data-browser";
import { SubgraphReindexForm } from "./reindex-form";

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
					{/* Metadata cards */}
					<MetaGrid
						items={[
							{ label: "ID", value: name, mono: true },
							{
								label: "Status",
								value: (
									<span className={`badge ${statusBadgeClass(displayStatus)}`}>
										{displayStatus}
									</span>
								),
							},
							{
								label: "Block Height",
								value: subgraph.lastProcessedBlock
									? `#${subgraph.lastProcessedBlock.toLocaleString()}`
									: "—",
								mono: true,
							},
							{ label: "Version", value: subgraph.version, mono: true },
							{
								label: "Events Indexed",
								value: subgraph.health.totalProcessed.toLocaleString(),
							},
							{
								label: "Error Rate",
								value: `${(subgraph.health.errorRate * 100).toFixed(1)}%`,
								valueColor:
									subgraph.health.errorRate > 0.05 ? "red" : "green",
							},
							{
								label: "Tables",
								value: String(tableEntries.length),
							},
							{
								label: "Total Rows",
								value: totalRows.toLocaleString(),
							},
						]}
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
										{Object.entries(table.columns).map(
											([colName, col]) => (
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
											),
										)}
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

					{/* Sources */}
					{subgraph.sources && Object.keys(subgraph.sources).length > 0 && (
						<DetailSection title="Sources">
							{Object.entries(subgraph.sources).map(
								([sourceName, source]) => (
									<div key={sourceName} className="sg-source-card">
										<div className="sg-source-header">
											<span className="sg-source-name">{sourceName}</span>
											<span className="sg-source-type">
												{source.type ?? "event"}
											</span>
										</div>
										<div className="sg-source-meta">
											{Boolean(source.contract_id) && (
												<span>
													<span className="label">Contract</span>{" "}
													<span className="val">{String(source.contract_id)}</span>
												</span>
											)}
											{Boolean(source.asset_identifier) && (
												<span>
													<span className="label">Asset</span>{" "}
													<span className="val">
														{String(source.asset_identifier)}
													</span>
												</span>
											)}
										</div>
									</div>
								),
							)}
						</DetailSection>
					)}

					{/* Definition */}
					<DetailSection title="Definition">
						<DetailCodeBlock
							label="SUBGRAPH DEFINITION"
							code={JSON.stringify(subgraph.definition ?? {}, null, 2)}
							showCopy
						/>
					</DetailSection>

					{/* Backfill / Reindex */}
					<DetailSection title="Backfill &amp; Reindex">
						<SubgraphReindexForm
							subgraphName={name}
							sessionToken={session ?? ""}
						/>
					</DetailSection>

					{/* Quick Actions */}
					<DetailSection title="Quick Actions">
						<DetailCodeBlock
							label="Add a view to this subgraph"
							code={`sl views scaffold ${name}`}
							showCopy
							showOpenInEditor
						/>
					</DetailSection>
				</div>
			</div>
		</>
	);
}
