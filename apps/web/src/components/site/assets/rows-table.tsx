export interface RowsTableProps {
	columns: readonly string[];
	/** Rightmost column is right-aligned. */
	rows: readonly (readonly string[])[];
	/** Optional per-row cell class for the first column (e.g. in/out). */
	firstClass?: (row: readonly string[]) => string | undefined;
}

/** Small mono example-rows table used on dataset cards. */
export function RowsTable({ columns, rows, firstClass }: RowsTableProps) {
	const last = columns.length - 1;
	return (
		<div className="rows">
			<table>
				<thead>
					<tr>
						{columns.map((c, i) => (
							<th key={c} className={i === last ? "r" : undefined}>
								{c}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.join("|")}>
							{row.map((cell, i) => (
								<td
									key={`${columns[i]}-${cell}`}
									className={
										i === last ? "r" : i === 0 ? firstClass?.(row) : undefined
									}
								>
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
