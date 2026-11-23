import type { StatusGroup } from "./status";

export const FINDABLE_MIN = 4;

export interface RowFilter {
	q: string;
	group: StatusGroup | "all";
}

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
