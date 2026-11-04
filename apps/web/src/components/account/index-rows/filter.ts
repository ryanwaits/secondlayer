import type { StatusGroup } from "./status";

/** The only threshold: search and the Status filter show from this many rows. */
export const FINDABLE_MIN = 4;

export interface RowFilter {
	q: string;
	group: StatusGroup | "all";
}

/** Rows whose text contains the query (case-insensitive) and whose status
 *  group matches. An empty filter keeps every row. */
export function filterRows<T>(
	rows: readonly T[],
	{ q, group }: RowFilter,
	textOf: (row: T) => string,
	groupOf: (row: T) => StatusGroup,
): T[] {
	const needle = q.trim().toLowerCase();
	return rows.filter(
		(row) =>
			(group === "all" || groupOf(row) === group) &&
			(!needle || textOf(row).toLowerCase().includes(needle)),
	);
}
