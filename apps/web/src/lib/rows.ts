/**
 * Pure helpers for the Rows screen: the `GET /api/billing/rows` shape and the
 * shaping from it to chart bars, copy and the errors table. No React, no
 * fetch, so `bun test` covers it.
 */

import { dollars } from "./billing-view";
import { formatRows } from "./usage";

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

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** "Oct 6" for a `YYYY-MM-DD` UTC date. */
export function shortDate(date: string): string {
	return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

export type RowsBar = { date: string; t: string; n: number; p: number };

/** The last 30 UTC days ending with `now`'s day: free rows as `n`, paid as
 *  `p`, summed across sources, zero-filled for days with no reads. The split
 *  is per metered page (a page that crossed the allowance counts as paid),
 *  so it is approximate at the crossing. */
export function dailyBars(daily: readonly RowsDay[], now: Date): RowsBar[] {
	const byDate = new Map<string, { n: number; p: number }>();
	for (const day of daily) {
		const sum = byDate.get(day.date) ?? { n: 0, p: 0 };
		sum.n += day.freeRows;
		sum.p += day.paidRows;
		byDate.set(day.date, sum);
	}
	const today = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	);
	return Array.from({ length: 30 }, (_, i) => {
		const date = utcDate(today - (29 - i) * DAY_MS);
		const sum = byDate.get(date);
		return { date, t: date.slice(5), n: sum?.n ?? 0, p: sum?.p ?? 0 };
	});
}

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

const fmt = (n: number) => n.toLocaleString("en-US");

/** The status sentence and its sub-line. */
export function statusCopy(allowance: RowsAllowance): {
	sentence: string;
	sub: string;
} {
	const sentence = `${formatRows(allowance.usedThisMonth)} rows this month.`;
	const always = "Block headers are always free.";
	if (allowance.exhaustedOn) {
		const paid = dollars(Number(allowance.paidUsdMicrosThisMonth) / 1_000_000);
		return {
			sentence,
			sub: `The free 1M ran out on ${shortDate(allowance.exhaustedOn)}. ${fmt(allowance.paidRowsThisMonth)} paid rows since, ${paid}. ${always}`,
		};
	}
	return {
		sentence,
		sub: `${fmt(allowance.usedThisMonth)} of your free 1M used. Resets ${shortDate(allowance.resetsOn)}. ${always}`,
	};
}

/** Long hex runs (tx ids, hashes) shortened to 8 characters and an ellipsis. */
export function shortenPath(path: string): string {
	return path.replace(/[0-9a-f]{40,}/gi, (hex) => `${hex.slice(0, 8)}…`);
}

/** Your own mistakes: 4xx only. */
export function clientErrors(errors: readonly RowsError[]): RowsError[] {
	return errors.filter((e) => e.status < 500);
}

/** Failures on our side: 5xx only. */
export function serverErrors(errors: readonly RowsError[]): RowsError[] {
	return errors.filter((e) => e.status >= 500);
}

/** "10× 400 · 15× 404" for the 4xx errors, most frequent status first. */
export function errorSummary(errors: readonly RowsError[]): string {
	const byStatus = new Map<number, number>();
	for (const e of clientErrors(errors)) {
		byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + e.count);
	}
	return [...byStatus.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([status, count]) => `${count}× ${status}`)
		.join(" · ");
}

/** Rows per UTC hour from midnight to the current hour, summed across sources
 *  and zero-filled: the Overview row's sparkline. */
export function hourlyPoints(hourly: readonly RowsHour[], now: Date): number[] {
	const midnight = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	);
	const points = Array.from({ length: now.getUTCHours() + 1 }, () => 0);
	for (const h of hourly) {
		const index = Math.floor((Date.parse(h.hour) - midnight) / 3_600_000);
		if (index >= 0 && index < points.length) points[index] += h.rows;
	}
	return points;
}
