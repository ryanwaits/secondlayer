"use client";

import { groupDigits } from "@/lib/subgraph-view";
import { fetchRecentRows } from "@/lib/subgraphs-store";
import { useEffect, useRef, useState } from "react";
import { JsonView } from "../webhooks/payload-view";
import {
	type RecentRow,
	type RecentRowsData,
	recentRowsData,
	sortRecent,
} from "./recent-rows-model";

/**
 * "Recent rows": the newest rows across a subgraph's tables, built like the
 * webhook page's "Recent deliveries". A row opens into the same payload
 * frame, showing its raw JSON.
 */

const VISIBLE_ROWS = 10;
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

/** The newest rows across the subgraph's tables. The page's server render
 *  reads them (`initial`); without it the browser reads them once. */
export function RecentRows({
	name,
	initial,
}: {
	name: string;
	initial?: RecentRowsData | null;
}) {
	const [data, setData] = useState<RecentRowsData | null>(initial ?? null);
	// The subgraph the server's rows belong to; another name reads again.
	const seededName = useRef(initial ? name : null);

	useEffect(() => {
		if (seededName.current === name) return;
		let live = true;
		setData(null);
		fetchRecentRows(name).then((res) => {
			if (live)
				setData(recentRowsData(res.kind === "ok" ? res.data.data : null));
		});
		return () => {
			live = false;
		};
	}, [name]);

	if (data?.failed) {
		return (
			<section className="dash-panel" id="sg-rows" aria-label="Recent rows">
				<div className="dash-panel-h">
					<span className="dash-label">Recent rows</span>
				</div>
				<p className="wd-faint">Couldn't load recent rows.</p>
			</section>
		);
	}
	return <RecentRowsBody name={name} rows={data?.rows ?? null} />;
}
