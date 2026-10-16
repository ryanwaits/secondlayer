"use client";

import {
	DEFAULT_SORT,
	PAGE_SIZE,
	type SortState,
	type TableFilter,
	filterParams,
	formatCell,
	gridColumns,
	groupDigits,
	isDefaultSort,
	queryCommand,
	rowsQuery,
	sdkSnippet,
	toggleSort,
	withFilter,
} from "@/lib/subgraph-view";
import {
	type SubgraphColumn,
	type SubgraphsResult,
	fetchRows,
	streamUrl,
} from "@/lib/subgraphs-store";
import { useEffect, useMemo, useRef, useState } from "react";
import { CopyAction } from "./copy-action";
import { RowPanel } from "./row-panel";

type Row = Record<string, unknown>;

/** How long the dot on a freshly landed row stays. */
export const FRESH_MS = 9_000;

function failureText(
	res: Exclude<SubgraphsResult<unknown>, { kind: "ok" }>,
): string {
	if (res.kind === "starting") return "Your hosted stack is still starting.";
	if (res.kind === "rate_limited") {
		return `Too many requests. Try again in ${res.retryAfter}s.`;
	}
	if (res.kind === "not_found") return "That table wasn't found.";
	if (res.kind === "no_credits") return "Add credits to read rows.";
	return res.message;
}

const rowKey = (row: Row, index: number) => String(row._id ?? index);

export interface GridViewProps {
	name: string;
	table: string;
	columns: Record<string, SubgraphColumn>;
	/** The table's row count from the subgraph detail. */
	rowCount: number;
	rows: Row[] | null;
	error: string | null;
	sort: SortState;
	filters: readonly TableFilter[];
	live: boolean;
	page: number;
	hasNext: boolean;
	loading: boolean;
	fresh: ReadonlySet<string>;
	openKey: string | null;
	now?: number;
	onSort: (column: string) => void;
	onFilter: (filter: TableFilter) => void;
	onRemoveFilter: (column: string) => void;
	onToggleRow: (key: string) => void;
	onNext: () => void;
	onNewest: () => void;
	onRetry: () => void;
}

/** The grid itself: tools row, table, open-row panel and footer. State and
 *  fetching live in `DataGrid`; this part renders from props. */
export function GridView({
	name,
	table,
	columns,
	rowCount,
	rows,
	error,
	sort,
	filters,
	live,
	page,
	hasNext,
	loading,
	fresh,
	openKey,
	now,
	onSort,
	onFilter,
	onRemoveFilter,
	onToggleRow,
	onNext,
	onNewest,
	onRetry,
}: GridViewProps) {
	const cols = useMemo(() => gridColumns(columns), [columns]);
	const filtered = filters.length > 0;
	const view = { name, table, sort: sort.column, order: sort.order, filters };
	const shown = rows ?? [];

	let footer: string;
	if (filtered) {
		footer = `Showing the first ${shown.length} ${shown.length === 1 ? "match" : "matches"}`;
	} else if (page > 1) {
		footer = `${groupDigits(String(rowCount))} rows · page ${page}`;
	} else {
		footer = `${groupDigits(String(rowCount))} rows · ${isDefaultSort(sort) ? "newest" : "first"} ${shown.length}`;
	}

	return (
		<div className="sg-grid" aria-busy={loading}>
			<div className="sg-tools">
				<span className="sg-chips">
					{filtered ? (
						filters.map((f) => {
							const cell = formatCell(
								columns[f.column]?.type ?? "text",
								f.column,
								f.value,
							);
							return (
								<button
									key={f.column}
									type="button"
									className="wd-fchip"
									title={cell.title}
									aria-label={`Remove filter ${f.column}`}
									onClick={() => onRemoveFilter(f.column)}
								>
									{f.column} = {cell.text} <i>×</i>
								</button>
							);
						})
					) : (
						<span>Open a row to filter by any of its values.</span>
					)}
				</span>
				{live ? (
					<span className="sg-live">
						<span className="dash-dot" />
						New rows land with each block
					</span>
				) : !isDefaultSort(sort) ? (
					<span>
						Sorted by {sort.column}, so new rows wait at the top of the default
						sort
					</span>
				) : null}
			</div>

			<div className="sg-grid-wrap">
				<table className="sg-table">
					<thead>
						<tr>
							{cols.map((col, i) => {
								const on = sort.column === col.name;
								return (
									<th
										key={col.name}
										className={`${on ? "on" : ""}${col.numeric ? " r" : ""}`}
										aria-sort={
											on
												? sort.order === "desc"
													? "descending"
													: "ascending"
												: "none"
										}
									>
										<button
											type="button"
											className="sg-sort"
											onClick={() => onSort(col.name)}
										>
											<span className="sg-colname">
												{i === 0 ? <span className="sg-slot" /> : null}
												{col.name}
												{on ? (sort.order === "desc" ? " ↓" : " ↑") : ""}
											</span>
											<small className={i === 0 ? "sg-first" : undefined}>
												{col.type}
											</small>
										</button>
									</th>
								);
							})}
						</tr>
					</thead>
					<tbody>
						{rows === null && !error ? (
							<tr>
								<td colSpan={cols.length} className="sg-empty-cell">
									Loading rows…
								</td>
							</tr>
						) : null}
						{error ? (
							<tr>
								<td colSpan={cols.length} className="sg-empty-cell">
									{error}{" "}
									<button type="button" className="sg-act" onClick={onRetry}>
										Retry
									</button>
								</td>
							</tr>
						) : null}
						{rows !== null && !error && shown.length === 0 ? (
							<tr>
								<td colSpan={cols.length} className="sg-empty-cell">
									{filtered
										? "No rows match these filters."
										: "No rows yet. They land here as the subgraph writes them."}
								</td>
							</tr>
						) : null}
						{shown.map((row, index) => {
							const key = rowKey(row, index);
							const open = openKey === key;
							return (
								<RowGroup
									key={key}
									row={row}
									cols={cols}
									columns={columns}
									fresh={fresh.has(key)}
									open={open}
									now={now}
									onToggle={() => onToggleRow(key)}
									onFilter={onFilter}
								/>
							);
						})}
					</tbody>
				</table>
			</div>

			<div className="sg-foot">
				<span>{footer}</span>
				<span className="sg-foot-acts">
					<CopyAction text={sdkSnippet(view)} label="Copy as SDK" />
					<CopyAction text={queryCommand(view)} label="Copy as CLI" />
					{page > 1 ? (
						<button type="button" className="sg-act" onClick={onNewest}>
							Back to newest
						</button>
					) : null}
					<button
						type="button"
						className="sg-act"
						disabled={!hasNext}
						onClick={onNext}
					>
						Next {PAGE_SIZE} ›
					</button>
				</span>
			</div>
		</div>
	);
}

function RowGroup({
	row,
	cols,
	columns,
	fresh,
	open,
	now,
	onToggle,
	onFilter,
}: {
	row: Row;
	cols: ReturnType<typeof gridColumns>;
	columns: Record<string, SubgraphColumn>;
	fresh: boolean;
	open: boolean;
	now?: number;
	onToggle: () => void;
	onFilter: (filter: TableFilter) => void;
}) {
	return (
		<>
			<tr
				className={`click${open ? " sel" : ""}`}
				tabIndex={0}
				aria-expanded={open}
				onClick={onToggle}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onToggle();
					}
				}}
			>
				{cols.map((col, i) => {
					const cell = formatCell(col.type, col.name, row[col.name]);
					return (
						<td key={col.name} className={col.numeric ? "r" : undefined}>
							{i === 0 ? (
								<span className={`sg-slot${fresh ? " new" : ""}`} />
							) : null}
							<span className={`sg-v ${cell.tone}`} title={cell.title}>
								{cell.text}
							</span>
						</td>
					);
				})}
			</tr>
			{open ? (
				<tr className="rowx">
					<td colSpan={cols.length}>
						<RowPanel
							row={row}
							columns={columns}
							now={now}
							onFilter={onFilter}
						/>
					</td>
				</tr>
			) : null}
		</>
	);
}

/**
 * One table's rows: keyset pages, sort, value filters, and the live tail.
 * Mount it with a `key` per subgraph and table so a switch starts clean.
 *
 * The live tail runs only on the default sort of the first page. It closes on
 * unmount, on any sort, filter or page change, and while the tab is hidden;
 * coming back re-reads the first page to cover the gap.
 */
export function DataGrid({
	name,
	table,
	columns,
	rowCount,
}: {
	name: string;
	table: string;
	columns: Record<string, SubgraphColumn>;
	rowCount: number;
}) {
	const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
	const [filters, setFilters] = useState<TableFilter[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [page, setPage] = useState(1);
	const [rows, setRows] = useState<Row[] | null>(null);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [reload, setReload] = useState(0);
	const [openKey, setOpenKey] = useState<string | null>(null);
	const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
	const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

	const live = isDefaultSort(sort) && cursor === null;
	const query = rowsQuery({
		sort: sort.column,
		order: sort.order,
		filters,
		cursor,
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: `reload` re-reads the same page on demand
	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		fetchRows(name, table, query).then((res) => {
			if (cancelled) return;
			setLoading(false);
			if (res.kind === "ok") {
				setError(null);
				setRows(res.data.rows);
				setNextCursor(res.data.next_cursor);
			} else {
				setError(failureText(res));
			}
		});
		return () => {
			cancelled = true;
		};
	}, [name, table, query, reload]);

	const liveReady = live && rows !== null && error === null;
	const streamQuery = filterParams(filters).toString();
	useEffect(() => {
		if (!liveReady || typeof EventSource === "undefined") return;
		let source: EventSource | null = null;

		function close() {
			source?.close();
			source = null;
		}
		function open() {
			close();
			source = new EventSource(streamUrl(name, table, streamQuery));
			source.onmessage = (event) => {
				let row: Row;
				try {
					row = JSON.parse(event.data) as Row;
				} catch {
					return;
				}
				const key = String(row._id ?? "");
				setRows((prev) => {
					if (!prev || prev.some((r) => String(r._id) === key)) return prev;
					return [row, ...prev].slice(0, PAGE_SIZE);
				});
				setFresh((prev) => new Set(prev).add(key));
				const timer = setTimeout(() => {
					timers.current.delete(timer);
					setFresh((prev) => {
						const next = new Set(prev);
						next.delete(key);
						return next;
					});
				}, FRESH_MS);
				timers.current.add(timer);
			};
			source.onerror = () => {
				// The browser retries a dropped stream; give up on a refused one.
				if (source?.readyState === EventSource.CLOSED) close();
			};
		}
		function onVisibility() {
			if (document.visibilityState === "hidden") {
				close();
			} else {
				setReload((n) => n + 1);
				open();
			}
		}

		if (document.visibilityState === "visible") open();
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			close();
		};
	}, [liveReady, name, table, streamQuery]);

	useEffect(() => {
		const pending = timers.current;
		return () => {
			for (const timer of pending) clearTimeout(timer);
			pending.clear();
		};
	}, []);

	function restart(patch: { sort?: SortState; filters?: TableFilter[] }) {
		if (patch.sort) setSort(patch.sort);
		if (patch.filters) setFilters(patch.filters);
		setCursor(null);
		setPage(1);
		setOpenKey(null);
	}

	return (
		<GridView
			name={name}
			table={table}
			columns={columns}
			rowCount={rowCount}
			rows={rows}
			error={error}
			sort={sort}
			filters={filters}
			live={live}
			page={page}
			hasNext={nextCursor !== null && (rows?.length ?? 0) >= PAGE_SIZE}
			loading={loading}
			fresh={fresh}
			openKey={openKey}
			onSort={(column) => restart({ sort: toggleSort(sort, column) })}
			onFilter={(filter) => restart({ filters: withFilter(filters, filter) })}
			onRemoveFilter={(column) =>
				restart({ filters: filters.filter((f) => f.column !== column) })
			}
			onToggleRow={(key) => setOpenKey((prev) => (prev === key ? null : key))}
			onNext={() => {
				setCursor(nextCursor);
				setPage((p) => p + 1);
				setOpenKey(null);
			}}
			onNewest={() => {
				setCursor(null);
				setPage(1);
				setOpenKey(null);
			}}
			onRetry={() => setReload((n) => n + 1)}
		/>
	);
}
