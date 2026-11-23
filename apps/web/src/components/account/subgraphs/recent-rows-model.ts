// Not a client module: the page's server render builds the same rows.

export type RecentRow = { table: string; row: Record<string, unknown> };

export type RecentRowsData = { rows: RecentRow[]; failed: boolean };

export function sortRecent(rows: readonly RecentRow[]): RecentRow[] {
	return [...rows].sort(
		(a, b) =>
			Number(b.row._block_height) - Number(a.row._block_height) ||
			Number(b.row._id) - Number(a.row._id),
	);
}

export function recentRowsData(
	rows: readonly RecentRow[] | null,
): RecentRowsData {
	return rows === null
		? { rows: [], failed: true }
		: { rows: [...rows], failed: false };
}
