/** Pure hourly bucketing of subgraph health snapshots, used by the API health route. */

const HOUR_MS = 3_600_000;

export interface HealthSnapshotPoint {
	captured_at: Date | string;
	chain_tip: string | number | null;
	last_processed_block: string | number | null;
	rows_written_total: string | number | null;
	total_errors: string | number;
	total_processed: string | number;
}

export interface HealthHour {
	hour: string;
	lagBlocks: number | null;
	rowsWritten: number;
	errors: number;
	eventsHandled: number;
}

/** Sum of positive consecutive differences; a counter reset counts as 0. */
function positiveDeltas(values: (number | null)[]): number {
	let total = 0;
	let prev: number | null = null;
	for (const value of values) {
		if (value === null) continue;
		if (prev !== null && value > prev) total += value - prev;
		prev = value;
	}
	return total;
}

function toNumber(value: string | number | null): number | null {
	if (value === null) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

/**
 * Bucket snapshots into the last `hours` UTC hours (oldest first, ending with
 * the hour containing `now`). The delta for an hour also spans the boundary
 * from the previous hour's last snapshot, so no growth falls between buckets.
 */
export function bucketHourly(
	snapshots: HealthSnapshotPoint[],
	hours: number,
	now: number = Date.now(),
): HealthHour[] {
	const sorted = snapshots
		.map((s) => ({ ...s, at: new Date(s.captured_at).getTime() }))
		.sort((a, b) => a.at - b.at);

	const currentHourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
	const out: HealthHour[] = [];

	for (let i = hours - 1; i >= 0; i--) {
		const start = currentHourStart - i * HOUR_MS;
		const end = start + HOUR_MS;
		const inHour = sorted.filter((s) => s.at >= start && s.at < end);

		if (inHour.length === 0) {
			out.push({
				hour: new Date(start).toISOString(),
				lagBlocks: null,
				rowsWritten: 0,
				errors: 0,
				eventsHandled: 0,
			});
			continue;
		}

		// Carry the last snapshot before this hour so boundary growth counts.
		const before = sorted.filter((s) => s.at < start).at(-1);
		const series = before ? [before, ...inHour] : inHour;

		const lags = inHour
			.map((s) => {
				const tip = toNumber(s.chain_tip);
				const cursor = toNumber(s.last_processed_block);
				return tip === null || cursor === null
					? null
					: Math.max(0, tip - cursor);
			})
			.filter((lag): lag is number => lag !== null);

		out.push({
			hour: new Date(start).toISOString(),
			lagBlocks: lags.length > 0 ? Math.max(...lags) : null,
			rowsWritten: positiveDeltas(
				series.map((s) => toNumber(s.rows_written_total)),
			),
			errors: positiveDeltas(series.map((s) => toNumber(s.total_errors))),
			eventsHandled: positiveDeltas(
				series.map((s) => toNumber(s.total_processed)),
			),
		});
	}

	return out;
}
