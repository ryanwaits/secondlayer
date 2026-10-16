"use client";

import {
	type TableFilter,
	canFilter,
	formatCell,
	groupDigits,
	isNumericType,
} from "@/lib/subgraph-view";
import type { SubgraphColumn } from "@/lib/subgraphs-store";
import { formatRelative } from "@/lib/webhooks-data";
import { CopyAction } from "./copy-action";

type Row = Record<string, unknown>;

/** A value as the panel prints it in full: grouped digits for numbers,
 *  indented JSON for documents, the raw string for the rest. */
function fullValue(type: string, value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (type === "jsonb") return JSON.stringify(value, null, 2);
	if (isNumericType(type)) return groupDigits(String(value));
	return String(value);
}

/** The panel under an open grid row: every column with a Filter link, and
 *  where the row came from. */
export function RowPanel({
	row,
	columns,
	now = Date.now(),
	onFilter,
}: {
	row: Row;
	columns: Record<string, SubgraphColumn>;
	now?: number;
	onFilter: (filter: TableFilter) => void;
}) {
	const tx = formatCell("text", "_tx_id", row._tx_id);
	const block = row._block_height;
	const written = row._created_at;
	return (
		<div className="sg-rowx">
			<div className="sg-rowx-col">
				<span className="dash-label">
					Row {groupDigits(String(row._id ?? ""))}
				</span>
				<dl className="sg-fields">
					{Object.entries(columns).map(([name, column]) => {
						const value = row[name];
						return (
							<div className="sg-field" key={name}>
								<dt>{name}</dt>
								<dd className={value === null ? "sg-null" : undefined}>
									{fullValue(column.type, value)}
								</dd>
								{canFilter(column.type, name, value) ? (
									<button
										type="button"
										className="sg-filter"
										aria-label={`Filter by ${name}`}
										onClick={() =>
											onFilter({ column: name, value: String(value) })
										}
									>
										Filter
									</button>
								) : (
									<span />
								)}
							</div>
						);
					})}
				</dl>
				<div>
					<CopyAction
						text={JSON.stringify(row, null, 2)}
						label="Copy as JSON"
						className="sg-btn"
					/>
				</div>
			</div>
			<div className="sg-rowx-col">
				<span className="dash-label">Where it came from</span>
				<dl className="rw-kv sg-came">
					<div>
						<dt>Block</dt>
						<dd>
							{block === null || block === undefined
								? "–"
								: `#${groupDigits(String(block))}`}
						</dd>
					</div>
					<div>
						<dt>Transaction</dt>
						<dd title={tx.title}>{tx.text}</dd>
					</div>
					<div>
						<dt>Written</dt>
						<dd>
							{typeof written === "string" ? formatRelative(written, now) : "–"}
						</dd>
					</div>
				</dl>
				<span className="wd-faint">
					Every row keeps the block and transaction it came from, so you can
					check it against the chain.
				</span>
			</div>
		</div>
	);
}
