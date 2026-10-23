/**
 * Pure helpers for the Rows screen: the `GET /api/billing/rows` shape and the
 * shaping from it to chart bars, copy and the errors table. No React, no
 * fetch, so `bun test` covers it.
 */

export type RowsAllowance = {
	monthly: number;
	usedThisMonth: number;
	/** First UTC day this month the free allowance ran out (YYYY-MM-DD). */
	exhaustedOn: string | null;
	paidRowsThisMonth: number;
	paidUsdMicrosThisMonth: string;
	/** First day of next month (YYYY-MM-DD). */
	resetsOn: string;
};

export type RowsDay = {
	date: string;
	source: string;
	rows: number;
	freeRows: number;
	paidRows: number;
	calls: number;
	paidUsdMicros: string;
};

export type RowsHour = {
	hour: string;
	source: string;
	rows: number;
	calls: number;
};

export type RowsSource = { source: string; rows: number; calls: number };

export type RowsBucket = {
	bucket: "1-9" | "10-99" | "100-499" | "500-999" | "1000+";
	calls: number;
	rows: number;
};

export type RowsError = {
	status: number;
	code: string;
	path: string;
	count: number;
	last: string;
};

/** `GET /api/billing/rows`. */
export type RowsResponse = {
	allowance: RowsAllowance;
	daily: RowsDay[];
	hourlyToday: RowsHour[];
	bySource: RowsSource[];
	histogram: RowsBucket[];
	errors: RowsError[];
};

/** "Oct 6" for a `YYYY-MM-DD` UTC date. */
export function shortDate(date: string): string {
	return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

export type RowsBar = { date: string; t: string; n: number; p: number };

/** Where the "free 1M used up" mark sits: between the exhaustion day's bar
 *  and the next one. The chart draws a mark at a bar's left edge, so that is
 *  the next bar's index; when the allowance ran out today there is no next
 *  bar and the mark sits at today's left edge. Null when not exhausted, or
 *  the day is outside the window. */
export function markIndex(
	days: readonly RowsBar[],
	exhaustedOn: string | null,
): number | null {
	if (!exhaustedOn) return null;
	const index = days.findIndex((d) => d.date === exhaustedOn);
	return index === -1 ? null : Math.min(index + 1, days.length - 1);
}

/** x labels at the first day, the 1st of the month, the exhaustion day and
 *  today. A label that lands on an already-labelled bar is dropped. */
export function xLabels(
	days: readonly RowsBar[],
	exhaustedOn: string | null,
): [number, string][] {
	const labels = new Map<number, string>();
	const add = (index: number) => {
		const day = days[index];
		if (day && !labels.has(index)) labels.set(index, shortDate(day.date));
	};
	add(0);
	add(days.findIndex((d) => d.date.endsWith("-01")));
	if (exhaustedOn) add(days.findIndex((d) => d.date === exhaustedOn));
	add(days.length - 1);
	return [...labels.entries()].sort((a, b) => a[0] - b[0]);
}
