"use client";

interface DataTableCardProps {
	subgraph: string;
	table: string;
	rows: Array<Record<string, unknown>>;
	meta?: { total?: number };
}

/** Internal columns to render dimmed */
const INTERNAL_COLS = new Set([
	"_id",
	"_created_at",
	"_updated_at",
	"_block_height",
]);

function formatCellValue(value: unknown): string {
	if (value === null || value === undefined) return "—";
	if (typeof value === "number") return value.toLocaleString();
	const str = String(value);
	// Truncate long strings (addresses, hashes)
	if (str.length > 42) return `${str.slice(0, 20)}…${str.slice(-8)}`;
	return str;
}

export function DataTableCard({
	subgraph,
	table,
	rows,
	meta,
}: DataTableCardProps) {
	if (rows.length === 0) {
		return (
			<div className="tool-card">
				<div className="tool-card-header">
					<svg
						width="12"
						height="12"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
					>
						<rect x="2" y="2" width="12" height="12" rx="2" />
						<path d="M2 6h12M6 2v12" />
					</svg>
					{table} · {subgraph}
				</div>
				<div className="tool-status-row">
					<span className="tool-status-meta">No rows returned</span>
				</div>
			</div>
		);
	}

	const columns = Object.keys(rows[0]);

	return (
		<div className="tool-card">
			<div className="tool-card-header">
				<svg
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				>
					<rect x="2" y="2" width="12" height="12" rx="2" />
					<path d="M2 6h12M6 2v12" />
				</svg>
				{table} · {subgraph}
			</div>
			<div style={{ overflowX: "auto" }}>
				<table className="data-table">
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
									<td
										key={col}
										className={INTERNAL_COLS.has(col) ? "td-muted" : undefined}
									>
										{formatCellValue(row[col])}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="table-footer">
				<span>
					{rows.length}
					{meta?.total != null && meta.total > rows.length
						? ` of ${meta.total.toLocaleString()}`
						: ""}{" "}
					rows
				</span>
			</div>
		</div>
	);
}
