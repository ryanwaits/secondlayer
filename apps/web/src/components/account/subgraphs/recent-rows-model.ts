// Not a client module: the page's server render builds the same rows.

export type RecentRow = { table: string; row: Record<string, unknown> };

/** What "Recent rows" shows: the rows, or that the read failed. */
export type RecentRowsData = { rows: RecentRow[]; failed: boolean };

/** Newest block first, then newest id. */
export function sortRecent(rows: readonly RecentRow[]): RecentRow[] {
	return [...rows].sort(
		(a, b) =>
			Number(b.row._block_height) - Number(a.row._block_height) ||
			Number(b.row._id) - Number(a.row._id),
	);
}

/** The recent-rows read as the panel shows it (`null` when the read failed). */
export function recentRowsData(
	rows: readonly RecentRow[] | null,
): RecentRowsData {
	return rows === null
		? { rows: [], failed: true }
		: { rows: [...rows], failed: false };
}
