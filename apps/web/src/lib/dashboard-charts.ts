/** Pure data shaping for the dashboard charts. */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WINDOW_HOURS = 168;

/** Round up to 1/2/5/10 x 10^k. Never returns 0 or NaN. */
export function niceMax(v: number): number {
	if (!Number.isFinite(v) || v <= 0) return 1;
	const p = 10 ** Math.floor(Math.log10(v));
	const m = v / p;
	return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Axis label: `value` plus `unit` when given, else a compact count (999, 1.2k, 3M). */
export function formatAxis(value: number, unit?: string): string {
	if (unit) return `${value}${unit}`;
	if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}k`;
	return String(Math.round(value));
}

/** Dollar axis tick: 0 is "$0", under 10 keeps one decimal ("$2.5"), else whole dollars. */
export function formatUsdTick(value: number): string {
	if (value === 0) return "$0";
	return `$${value.toFixed(value < 10 ? 1 : 0)}`;
}

export interface HeatCell {
	index: number;
	n: number;
	f: number;
}
export interface HeatDay {
	label: string;
	cells: (HeatCell | null)[];
}

/** Start of the rolling window: the hour 167 h before `now`, floored to the hour. */
function windowStart(now: number): number {
	return Math.floor(now / HOUR) * HOUR - (WINDOW_HOURS - 1) * HOUR;
}

/**
 * Lay a rolling 168-hour array (index 0 = the hour 167 h before `now`) on UTC
 * calendar days: one row per day the window touches, 24 columns. Cells outside
 * the window are null.
 */
export function heatGrid(
	hours: readonly { n: number; f: number }[],
	now: number,
): { days: HeatDay[] } {
	const h0 = windowStart(now);
	const d0 = Math.floor(h0 / DAY) * DAY;
	const nDays = Math.ceil((now - d0) / DAY);
	const days: HeatDay[] = [];
	for (let d = 0; d < nDays; d++) {
		const dayStart = d0 + d * DAY;
		const date = new Date(dayStart);
		const weekday = date.toLocaleDateString("en-US", {
			weekday: "short",
			timeZone: "UTC",
		});
		const cells: (HeatCell | null)[] = [];
		for (let hr = 0; hr < 24; hr++) {
			const index = (dayStart + hr * HOUR - h0) / HOUR;
			if (index < 0 || index >= WINDOW_HOURS) {
				cells.push(null);
				continue;
			}
			const c = hours[index];
			cells.push({ index, n: c?.n ?? 0, f: c?.f ?? 0 });
		}
		days.push({ label: `${weekday} ${date.getUTCDate()}`, cells });
	}
	return { days };
}

const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
	weekday: "short",
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

/** "Thu, Oct 8 · 23:00–00:00 UTC" for the hour at `index`. */
export function hourWindowLabel(index: number, now: number): string {
	const start = windowStart(now) + index * HOUR;
	const date = DAY_LABEL.format(new Date(start));
	const clock = (t: number) => new Date(t).toISOString().slice(11, 13);
	return `${date} · ${clock(start)}:00–${clock(start + HOUR)}:00 UTC`;
}

/** Cumulative spend and a projection at the mean of the last (up to) 7 days. */
export function spendProjection(daily: readonly number[], daysInMonth: number) {
	let running = 0;
	const cumulative = daily.map((d) => {
		running += d;
		return running;
	});
	const recent = daily.slice(-7);
	const ratePerDay = recent.length
		? recent.reduce((a, b) => a + b, 0) / recent.length
		: 0;
	const remaining = Math.max(0, daysInMonth - daily.length);
	return {
		cumulative,
		spent: running,
		ratePerDay,
		projectedEnd: running + ratePerDay * remaining,
	};
}

export interface BarsRow {
	i: number;
	n: number;
	p: number;
	f: number;
	bandLow: number | null;
	bandRange: number | null;
	highlighted: boolean;
}

/** Recharts-ready rows. The band `[low, high]` becomes bandLow + bandRange. */
export function barsRows(
	series: readonly { n?: number; p?: number; f?: number }[],
	opts: {
		band?: readonly (readonly [number, number])[];
		highlight?: readonly number[];
	} = {},
): BarsRow[] {
	return series.map((s, i) => {
		const band = opts.band?.[i];
		return {
			i,
			n: s.n ?? 0,
			p: s.p ?? 0,
			f: s.f ?? 0,
			bandLow: band ? band[0] : null,
			bandRange: band ? band[1] - band[0] : null,
			highlighted: opts.highlight?.includes(i) ?? false,
		};
	});
}

/** Width of the chart mark pill: a mono glyph is about 0.6em wide, plus padding on each side. */
export function markPillWidth(
	label: string,
	fontSize = 10.5,
	padding = 5,
): number {
	return Math.ceil(label.length * fontSize * 0.6 + padding * 2);
}
