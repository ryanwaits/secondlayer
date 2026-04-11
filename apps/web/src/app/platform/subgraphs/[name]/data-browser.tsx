"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

interface SubgraphDataBrowserProps {
	subgraphName: string;
	tables: string[];
	sessionToken: string;
	/** When provided, parent controls which table is active */
	controlledTable?: string;
	/** Hide built-in table tabs (when parent owns the tabs) */
	hideTableTabs?: boolean;
}

const LIMIT = 10;
const SKELETON_ROWS = 5;
const SKELETON_COLS = 5;

function fetchPage(
	subgraphName: string,
	table: string,
	page: number,
	sessionToken: string,
) {
	return async () => {
		const res = await fetch(
			`/api/subgraphs/${subgraphName}/${table}?_limit=${LIMIT}&_offset=${page * LIMIT}&_sort=_block_height&_order=desc`,
			{ headers: { Authorization: `Bearer ${sessionToken}` } },
		);
		if (!res.ok) return { rows: [], total: 0 };
		const json = (await res.json()) as {
			data: Record<string, unknown>[];
			meta: { total: number };
		};
		return { rows: json.data, total: json.meta.total };
	};
}

const SKELETON_HEADERS = Array.from({ length: SKELETON_COLS }, (_, i) => ({
	id: `sk-h-${i}`,
	width: 60 + (i % 3) * 20,
}));
const SKELETON_BODY = Array.from({ length: SKELETON_ROWS }, (_, ri) => ({
	id: `sk-r-${ri}`,
	cells: Array.from({ length: SKELETON_COLS }, (_, ci) => ({
		id: `sk-c-${ri}-${ci}`,
		width: 40 + ((ri + ci) % 4) * 20,
	})),
}));

function SkeletonTable() {
	return (
		<table className="sg-table">
			<thead>
				<tr>
					{SKELETON_HEADERS.map((h) => (
						<th key={h.id}>
							<span className="skeleton" style={{ width: h.width }} />
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{SKELETON_BODY.map((row) => (
					<tr key={row.id}>
						{row.cells.map((cell) => (
							<td key={cell.id}>
								<span className="skeleton" style={{ width: cell.width }} />
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}

export function SubgraphDataBrowser({
	subgraphName,
	tables,
	sessionToken,
	controlledTable,
	hideTableTabs,
}: SubgraphDataBrowserProps) {
	const [internalTable, setInternalTable] = useState(tables[0] ?? "");
	const activeTable = controlledTable ?? internalTable;
	const setActiveTable = (t: string) => setInternalTable(t);
	const [page, setPage] = useState(0);
	const queryClient = useQueryClient();

	const queryKey = ["subgraph-data", subgraphName, activeTable, page];

	const { data, isLoading, isFetching, isPlaceholderData } = useQuery({
		queryKey,
		queryFn: fetchPage(subgraphName, activeTable, page, sessionToken),
		staleTime: 30_000,
		placeholderData: (prev) => prev,
		enabled: !!activeTable,
	});

	// Reset page when controlled table changes
	useEffect(() => {
		setPage(0);
	}, [controlledTable]);

	// Prefetch next page
	useEffect(() => {
		const total = data?.total ?? 0;
		if ((page + 1) * LIMIT < total) {
			queryClient.prefetchQuery({
				queryKey: ["subgraph-data", subgraphName, activeTable, page + 1],
				queryFn: fetchPage(subgraphName, activeTable, page + 1, sessionToken),
				staleTime: 30_000,
			});
		}
	}, [data, page, subgraphName, activeTable, sessionToken, queryClient]);

	const rows = data?.rows ?? [];
	const total = data?.total ?? 0;
	const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
	const stale = isFetching && isPlaceholderData;

	return (
		<>
			{!hideTableTabs && tables.length > 1 && (
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

			{isLoading && !data ? (
				<SkeletonTable />
			) : rows.length === 0 ? (
				<div
					style={{ padding: "20px 0", color: "var(--text-dim)", fontSize: 13 }}
				>
					No data in {activeTable}.
				</div>
			) : (
				<>
					<div className="sg-table-scroll">
						<table
							className="sg-table"
							style={{
								opacity: stale ? 0.5 : 1,
								transition: "opacity 100ms",
							}}
						>
							<thead>
								<tr>
									{columns.map((col) => (
										<th key={col}>{col}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => (
									<tr key={String(row._id ?? row.tx_id ?? row.contract_id)}>
										{columns.map((col) => (
											<td key={col}>
												<span className="mono">
													{String(row[col] ?? "—")}
												</span>
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div className="sg-data-pagination">
						<span>
							Showing {page * LIMIT + 1}&ndash;
							{Math.min((page + 1) * LIMIT, total)} of {total.toLocaleString()}
						</span>
						<div style={{ display: "flex", gap: 4 }}>
							<button
								type="button"
								className={`sg-data-page-btn${page === 0 ? " disabled" : ""}`}
								disabled={page === 0}
								onClick={() => setPage(Math.max(0, page - 1))}
							>
								&larr; Prev
							</button>
							<button
								type="button"
								className={`sg-data-page-btn${(page + 1) * LIMIT >= total ? " disabled" : ""}`}
								disabled={(page + 1) * LIMIT >= total}
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
