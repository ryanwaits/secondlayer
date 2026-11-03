"use client";

import { groupDigits } from "@/lib/subgraph-view";
import { fetchRows } from "@/lib/subgraphs-store";
import { useEffect, useState } from "react";
import { JsonView } from "../webhooks/payload-view";

/**
 * "Recent rows": the newest rows across a subgraph's tables, built like the
 * webhook page's "Recent deliveries". A row opens into the same payload
 * frame, showing its raw JSON.
 */

export type RecentRow = { table: string; row: Record<string, unknown> };

const VISIBLE_ROWS = 10;
const KEPT_ROWS = 20;
/** Tables read for the merge, biggest first; bounds the fan-out. */
const MAX_TABLES = 8;
const PER_TABLE = 10;
const COPIED_MS = 1200;

const asText = (value: unknown): string =>
	value === null || value === undefined ? "" : String(value);

const shortTx = (tx: string): string =>
	tx.length > 11 ? `${tx.slice(0, 6)}…${tx.slice(-4)}` : tx || "–";

/** "HH:MM:SS" of an ISO timestamp, in UTC. */
const clock = (iso: string): string =>
	iso.length >= 19 ? iso.slice(11, 19) : "–";

const blockLabel = (row: Record<string, unknown>): string =>
	`#${groupDigits(asText(row._block_height))}`;

function sizeLabel(text: string): string {
	const bytes = new TextEncoder().encode(text).length;
	return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

const rowKey = ({ table, row }: RecentRow): string =>
	`${table}:${asText(row._id)}`;

/** Newest block first, then newest id. */
export function sortRecent(rows: readonly RecentRow[]): RecentRow[] {
	return [...rows].sort(
		(a, b) =>
			Number(b.row._block_height) - Number(a.row._block_height) ||
			Number(b.row._id) - Number(a.row._id),
	);
}

type Tab = "row" | "query";

function RowPayload({ name, table, row }: RecentRow & { name: string }) {
	const [tab, setTab] = useState<Tab>("row");
	const [copied, setCopied] = useState(false);
	const rowText = JSON.stringify(row, null, 2);
	const queryText = `curl "https://api.secondlayer.tools/v1/subgraphs/${name}/${table}/${asText(row._id)}" \\\n  -H "Authorization: Bearer $SECONDLAYER_API_KEY"`;
	const copy = tab === "row" ? rowText : queryText;
	return (
		<div className="pv">
			<div className="pv-bar">
				<div className="tabbar mono" role="tablist">
					<button
						type="button"
						role="tab"
						aria-selected={tab === "row"}
						onClick={() => setTab("row")}
					>
						Row
						<span className="n">{sizeLabel(rowText)}</span>
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={tab === "query"}
						onClick={() => setTab("query")}
					>
						Query
					</button>
				</div>
				<button
					type="button"
					className="pv-copy"
					onClick={async () => {
						try {
							await navigator.clipboard.writeText(copy);
							setCopied(true);
							setTimeout(() => setCopied(false), COPIED_MS);
						} catch {
							// Clipboard blocked: leave the label as is.
						}
					}}
				>
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<div className="pv-body">
				{tab === "row" ? (
					<JsonView value={row} />
				) : (
					<pre className="j">{queryText}</pre>
				)}
			</div>
		</div>
	);
}

function RecentRowView({
	name,
	entry,
	open,
	onToggle,
}: {
	name: string;
	entry: RecentRow;
	open: boolean;
	onToggle: () => void;
}) {
	const { table, row } = entry;
	const tx = asText(row._tx_id);
	const written = clock(asText(row._created_at));
	return (
		<>
			<tr
				className="click"
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
				<td>{blockLabel(row)}</td>
				<td>{table}</td>
				<td>{shortTx(tx)}</td>
				<td className="r">{written}</td>
			</tr>
			{open ? (
				<tr className="exp">
					<td colSpan={4}>
						<div
							className="ins-timeline"
							style={{ "--n": 1 } as React.CSSProperties}
						>
							<div className="ok">
								<b>
									{table} · row {groupDigits(asText(row._id))}
								</b>
								block {blockLabel(row)} · tx {shortTx(tx)}
								<br />
								<small>written {written} UTC</small>
							</div>
						</div>
						<RowPayload name={name} table={table} row={row} />
					</td>
				</tr>
			) : null}
		</>
	);
}

/** The pure body: `rows` is null while loading. */
export function RecentRowsBody({
	name,
	rows,
}: {
	name: string;
	rows: readonly RecentRow[] | null;
}) {
	const [open, setOpen] = useState<string | null>(null);
	const [showAll, setShowAll] = useState(false);
	const sorted = rows === null ? [] : sortRecent(rows);
	const shown = showAll ? sorted : sorted.slice(0, VISIBLE_ROWS);
	return (
		<section className="dash-panel" id="sg-rows" aria-label="Recent rows">
			<div className="dash-panel-h">
				<span className="dash-label">Recent rows</span>
				<span className="wd-faint">click a row for its values</span>
			</div>
			<div className="wd-tbl-wrap">
				<table className="wd-tbl">
					<thead>
						<tr>
							<th>Block</th>
							<th>Table</th>
							<th>Transaction</th>
							<th className="r">Written (UTC)</th>
						</tr>
					</thead>
					<tbody aria-busy={rows === null}>
						{rows === null ? (
							<>
								{Array.from({ length: 5 }).map((_, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
									<tr key={i}>
										<td colSpan={4}>
											<span
												className="wh-skel"
												aria-hidden="true"
												style={{ display: "block", height: 14 }}
											/>
										</td>
									</tr>
								))}
							</>
						) : sorted.length === 0 ? (
							<tr>
								<td colSpan={4} className="wd-faint wd-empty">
									No rows yet.
								</td>
							</tr>
						) : null}
						{shown.map((entry) => {
							const key = rowKey(entry);
							return (
								<RecentRowView
									key={key}
									name={name}
									entry={entry}
									open={open === key}
									onToggle={() => setOpen(open === key ? null : key)}
								/>
							);
						})}
					</tbody>
				</table>
			</div>
			{sorted.length > VISIBLE_ROWS ? (
				<button
					type="button"
					className="wd-more"
					onClick={() => setShowAll((v) => !v)}
				>
					{showAll ? "Show fewer" : `Show all ${sorted.length}`}
				</button>
			) : null}
		</section>
	);
}

/** Reads the newest rows of the biggest tables once, then merges them. */
export function RecentRows({
	name,
	tables,
}: {
	name: string;
	/** Table names with their row counts. */
	tables: Record<string, { rowCount: number }>;
}) {
	const [rows, setRows] = useState<RecentRow[] | null>(null);
	const [failed, setFailed] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per subgraph; the page doesn't poll rows
	useEffect(() => {
		let live = true;
		setRows(null);
		setFailed(false);
		const biggest = Object.entries(tables)
			.sort(([, a], [, b]) => b.rowCount - a.rowCount)
			.slice(0, MAX_TABLES)
			.map(([table]) => table);
		Promise.all(
			biggest.map(async (table) => {
				const res = await fetchRows(
					name,
					table,
					`_sort=_block_height&_order=desc&_limit=${PER_TABLE}`,
				);
				return res.kind === "ok"
					? res.data.rows.map((row) => ({ table, row }))
					: null;
			}),
		).then((results) => {
			if (!live) return;
			const ok = results.filter((r) => r !== null);
			if (biggest.length > 0 && ok.length === 0) {
				setFailed(true);
				setRows([]);
				return;
			}
			setRows(sortRecent(ok.flat()).slice(0, KEPT_ROWS));
		});
		return () => {
			live = false;
		};
	}, [name]);

	if (failed) {
		return (
			<section className="dash-panel" id="sg-rows" aria-label="Recent rows">
				<div className="dash-panel-h">
					<span className="dash-label">Recent rows</span>
				</div>
				<p className="wd-faint">Couldn't load recent rows.</p>
			</section>
		);
	}
	return <RecentRowsBody name={name} rows={rows} />;
}
