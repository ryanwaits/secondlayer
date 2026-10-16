"use client";

import type { SubgraphTableInfo } from "@/lib/subgraphs-store";

/** Columns the platform adds to every table. */
const SYSTEM_COLUMNS = new Set([
	"_id",
	"_block_height",
	"_tx_id",
	"_created_at",
]);

/** Indexed by the schema, by a listed index that leads with the column, or
 *  because it is the row id. */
export function isIndexed(table: SubgraphTableInfo, column: string): boolean {
	if (column === "_id") return true;
	if (table.columns[column]?.indexed) return true;
	return table.indexes?.some((index) => index[0] === column) ?? false;
}

export function columnNotes(table: SubgraphTableInfo, column: string): string {
	const info = table.columns[column];
	return [
		SYSTEM_COLUMNS.has(column) ? "added by secondlayer" : null,
		info?.nullable ? "nullable" : null,
		info?.searchable ? "searchable" : null,
	]
		.filter(Boolean)
		.join(" · ");
}

/** A table's columns: type, whether it is indexed, and notes. */
export function SchemaView({ table }: { table: SubgraphTableInfo }) {
	return (
		<div className="sg-schema">
			<div className="sg-grid-wrap">
				<table className="sg-table">
					<thead>
						<tr>
							<th>
								<span className="sg-sort">column</span>
							</th>
							<th>
								<span className="sg-sort">type</span>
							</th>
							<th>
								<span className="sg-sort">indexed</span>
							</th>
							<th>
								<span className="sg-sort">notes</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{Object.entries(table.columns).map(([name, column]) => (
							<tr key={name}>
								<td>{name}</td>
								<td>
									<span className="sg-v sub">{column.type}</span>
								</td>
								<td>
									{isIndexed(table, name) ? (
										"yes"
									) : (
										<span className="sg-v faint">no</span>
									)}
								</td>
								<td className="sg-notes">{columnNotes(table, name)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
