import { CollapsibleSection } from "@/components/console/collapsible-section";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import { ApiError, getSessionFromCookies } from "@/lib/api";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type { SubgraphDetail } from "@/lib/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubgraphDataBrowser } from "../data-browser";

export default async function TableDetailPage({
	params,
}: {
	params: Promise<{ name: string; table: string }>;
}) {
	const { name, table } = await params;
	const session = await getSessionFromCookies();

	if (!session) notFound();

	let subgraph: SubgraphDetail;
	try {
		subgraph = await fetchFromTenantOrThrow<SubgraphDetail>(
			session,
			`/api/subgraphs/${name}`,
		);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) notFound();
		throw e;
	}

	const tableInfo = subgraph.tables[table];
	if (!tableInfo) notFound();

	const columns = Object.entries(tableInfo.columns);
	const indexedCount = columns.filter(([, c]) => c.indexed).length;

	return (
		<>
			<OverviewTopbar
				path={
					<>
						<Link
							href="/subgraphs"
							style={{ color: "inherit", textDecoration: "none" }}
						>
							Subgraphs
						</Link>{" "}
						/{" "}
						<Link
							href={`/subgraphs/${name}`}
							style={{ color: "inherit", textDecoration: "none" }}
						>
							{name}
						</Link>
					</>
				}
				page={table}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* Header */}
					<div className="tb-hdr">
						<div className="tb-hdr-identity">
							<span className="tb-hdr-name">{table}</span>
							<span className="tb-badge rows">
								{tableInfo.rowCount.toLocaleString()} rows
							</span>
							<span className="tb-badge cols">{columns.length} columns</span>
						</div>
					</div>

					{/* Endpoint */}
					<div className="sg-ep">
						<span className="sg-ep-method">GET</span>
						<span className="sg-ep-url">
							https://api.secondlayer.tools/api/subgraphs/{name}/
							<span className="hl">{table}</span>
						</span>
						<a
							href="https://docs.secondlayer.dev/api"
							className="sg-ep-link"
							target="_blank"
							rel="noopener noreferrer"
						>
							Full reference →
						</a>
					</div>

					{/* Data */}
					<CollapsibleSection title="Data" count={tableInfo.rowCount}>
						<SubgraphDataBrowser
							subgraphName={name}
							tables={[table]}
							sessionToken={session}
							controlledTable={table}
							hideTableTabs
						/>
					</CollapsibleSection>

					{/* Schema */}
					<CollapsibleSection title="Schema" count={columns.length}>
						<div className="tb-schema-wrap">
							<div className="tb-schema-toolbar">
								<span className="tb-schema-meta">
									{columns.length} columns · {indexedCount} indexed
								</span>
							</div>
							<table className="tb-schema-table">
								<thead>
									<tr>
										<th style={{ width: "35%" }}>Column</th>
										<th style={{ width: "25%" }}>Type</th>
										<th>Attributes</th>
									</tr>
								</thead>
								<tbody>
									{columns.map(([colName, col]) => (
										<tr key={colName}>
											<td>
												<span
													className={`tb-col-name${colName.startsWith("_") ? " sys" : ""}`}
												>
													{colName}
												</span>
											</td>
											<td>
												<span className="tb-col-type">{col.type}</span>
											</td>
											<td>
												{colName.startsWith("_") && (
													<span className="tb-col-badge sys">system</span>
												)}
												{col.indexed && (
													<span className="tb-col-badge idx">indexed</span>
												)}
												{col.searchable && (
													<span className="tb-col-badge idx">searchable</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</CollapsibleSection>
				</div>
			</div>
		</>
	);
}
