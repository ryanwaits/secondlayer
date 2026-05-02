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

const HEX_RE = /^0x[0-9a-fA-F]{8,}$/;
const STX_ADDR_RE = /^S[PMNT][0-9A-Z]{38,40}(?:\.[a-zA-Z][a-zA-Z0-9-_]*)?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function truncateMiddle(s: string, head: number, tail: number) {
	if (s.length <= head + tail + 1) return s;
	return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function relTime(iso: string) {
	const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (diff < 5) return "just now";
	if (diff < 60) return `${diff}s ago`;
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

function copy(value: string) {
	if (typeof navigator !== "undefined" && navigator.clipboard) {
		void navigator.clipboard.writeText(value);
	}
}

function prettyHeader(col: string) {
	return col.replace(/^_+/, "").replace(/_/g, " ");
}

function Cell({ value }: { value: unknown }) {
	if (value === null || value === undefined || value === "") {
		return <span className="sg-cell-empty">—</span>;
	}
	if (typeof value === "boolean") {
		return <span className="mono">{value ? "true" : "false"}</span>;
	}
	const s = String(value);

	if (HEX_RE.test(s)) {
		return (
			<button
				type="button"
				className="sg-cell-copy"
				title={`${s}\nclick to copy`}
				onClick={() => copy(s)}
			>
				<span className="mono">{truncateMiddle(s, 6, 4)}</span>
			</button>
		);
	}

	if (STX_ADDR_RE.test(s)) {
		const dot = s.indexOf(".");
		const addr = dot === -1 ? s : s.slice(0, dot);
		const contract = dot === -1 ? null : s.slice(dot);
		return (
			<button
				type="button"
				className="sg-cell-copy"
				title={`${s}\nclick to copy`}
				onClick={() => copy(s)}
			>
				<span className="mono">{truncateMiddle(addr, 5, 4)}</span>
				{contract && <span className="sg-cell-contract">{contract}</span>}
			</button>
		);
	}

	if (ISO_RE.test(s)) {
		return (
			<span className="sg-cell-time" title={s}>
				{relTime(s)}
			</span>
		);
	}

	if (typeof value === "number" || (/^-?\d+$/.test(s) && s.length < 16)) {
		const n = Number(s);
		if (Number.isFinite(n) && Math.abs(n) >= 1000) {
			return <span className="mono sg-cell-num">{n.toLocaleString()}</span>;
		}
		return <span className="mono sg-cell-num">{s}</span>;
	}

	return <span className="mono">{s}</span>;
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: only react to external (controlled) table changes, not internal ones
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
										<th key={col}>{prettyHeader(col)}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => (
									<tr key={String(row._id ?? row.tx_id ?? row.contract_id)}>
										{columns.map((col) => (
											<td key={col}>
												<Cell value={row[col]} />
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
