"use client";

import type { ReactNode } from "react";

interface Column<T> {
	key: string;
	header: string;
	render?: (row: T) => ReactNode;
	className?: string;
}

interface DataTableProps<T> {
	columns: Column<T>[];
	data: T[];
	onRowClick?: (row: T) => void;
	/** If true, applies has-tooltip class to cells that contain tooltips */
	tooltipColumn?: string;
}

export function DataTable<T extends Record<string, unknown>>({
	columns,
	data,
	onRowClick,
	tooltipColumn,
}: DataTableProps<T>) {
	return (
		<table className="sg-table">
			<thead>
				<tr>
					{columns.map((col) => (
						<th key={col.key}>{col.header}</th>
					))}
				</tr>
			</thead>
			<tbody>
				{data.map((row, i) => (
					<tr
						key={i}
						onClick={onRowClick ? () => onRowClick(row) : undefined}
						style={onRowClick ? { cursor: "pointer" } : undefined}
					>
						{columns.map((col) => (
							<td
								key={col.key}
								className={[
									col.className,
									tooltipColumn === col.key ? "has-tooltip" : "",
								]
									.filter(Boolean)
									.join(" ")}
							>
								{col.render ? col.render(row) : (row[col.key] as ReactNode)}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}
