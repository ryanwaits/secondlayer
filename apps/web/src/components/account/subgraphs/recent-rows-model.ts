// Not a client module: the page's server render builds the same rows.

export type RecentRow = { table: string; row: Record<string, unknown> };

/** What "Recent rows" shows: the merged rows, or that every table read failed. */
export type RecentRowsData = { rows: RecentRow[]; failed: boolean };

export const KEPT_ROWS = 20;
/** Tables read for the merge, biggest first; bounds the fan-out. */
export const MAX_TABLES = 8;
export const PER_TABLE = 10;

/** One table's newest rows, newest block first. */
export const RECENT_ROWS_QUERY = `_sort=_block_height&_order=desc&_limit=${PER_TABLE}`;

/** Newest block first, then newest id. */
export function sortRecent(rows: readonly RecentRow[]): RecentRow[] {
	return [...rows].sort(
		(a, b) =>
			Number(b.row._block_height) - Number(a.row._block_height) ||
			Number(b.row._id) - Number(a.row._id),
	);
}

/** The tables to read, biggest first, capped at `MAX_TABLES`. */
export function biggestTables(
	tables: Record<string, { rowCount: number }>,
): string[] {
	return Object.entries(tables)
		.sort(([, a], [, b]) => b.rowCount - a.rowCount)
		.slice(0, MAX_TABLES)
		.map(([table]) => table);
}

/** Merges each table's rows (`null` when its read failed). Every read failing
 *  is a failure; one failing just leaves its rows out. */
export function foldRecentRows(
	tables: readonly string[],
	results: readonly (readonly RecentRow[] | null)[],
): RecentRowsData {
	const ok = results.filter((r) => r !== null);
	if (tables.length > 0 && ok.length === 0) return { rows: [], failed: true };
	return { rows: sortRecent(ok.flat()).slice(0, KEPT_ROWS), failed: false };
}
