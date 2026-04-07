"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface SubgraphDataBrowserProps {
	subgraphName: string;
	tables: string[];
	sessionToken: string;
}

export function SubgraphDataBrowser({
	subgraphName,
	tables,
	sessionToken,
}: SubgraphDataBrowserProps) {
	const [activeTable, setActiveTable] = useState(tables[0] ?? "");
	const [page, setPage] = useState(0);
	const limit = 10;

	const { data, isLoading } = useQuery({
		queryKey: ["subgraph-data", subgraphName, activeTable, page],
		queryFn: async () => {
			const res = await fetch(
				`/api/subgraphs/${subgraphName}/${activeTable}?_limit=${limit}&_offset=${page * limit}&_sort=_block_height&_order=desc`,
				{ headers: { Authorization: `Bearer ${sessionToken}` } },
			);
			if (!res.ok) return { rows: [], total: 0 };
			const json = (await res.json()) as {
				data: Record<string, unknown>[];
				meta: { total: number };
			};
			return { rows: json.data, total: json.meta.total };
		},
		staleTime: 30_000,
		enabled: !!activeTable,
	});

	const rows = data?.rows ?? [];
	const total = data?.total ?? 0;
	const columns = rows.length > 0 ? Object.keys(rows[0]).slice(0, 5) : [];

	return (
		<>
			{tables.length > 1 && (
				<div className="sg-data-tabs">
					{tables.map((t) => (
						<button
							key={t}
							type="button"
							className={`sg-data-tab${t === activeTable ? " active" : ""}`}
							onClick={() => {
								setActiveTable(t);
								setPage(0);
							}}
						>
							{t}
						</button>
					))}
				</div>
			)}

			{isLoading ? (
				<div
					style={{
						padding: "20px 0",
						color: "var(--text-muted)",
						fontSize: 13,
					}}
				>
					Loading...
				</div>
			) : rows.length === 0 ? (
				<div
					style={{ padding: "20px 0", color: "var(--text-dim)", fontSize: 13 }}
				>
					No data in {activeTable}.
				</div>
			) : (
				<>
					<table className="sg-table">
						<thead>
							<tr>
								{columns.map((col) => (
									<th key={col}>{col}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((row, i) => (
								<tr key={i}>
									{columns.map((col) => (
										<td key={col}>
											<span className="mono">
												{String(row[col] ?? "—").slice(0, 40)}
											</span>
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
					<div className="sg-data-pagination">
						<span>
							Showing {page * limit + 1}&ndash;
							{Math.min((page + 1) * limit, total)} of {total.toLocaleString()}
						</span>
						<div style={{ display: "flex", gap: 4 }}>
							<button
								type="button"
								className={`sg-data-page-btn${page === 0 ? " disabled" : ""}`}
								onClick={() => setPage(Math.max(0, page - 1))}
							>
								&larr; Prev
							</button>
							<button
								type="button"
								className={`sg-data-page-btn${(page + 1) * limit >= total ? " disabled" : ""}`}
								onClick={() => setPage(page + 1)}
							>
								Next &rarr;
							</button>
						</div>
					</div>
				</>
			)}
		</>
	);
}
