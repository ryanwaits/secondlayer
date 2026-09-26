import type {
	DeliveryRow,
	WebhookActivity,
	WebhookActivityHour,
} from "@secondlayer/sdk";

/**
 * Pure series math for the webhook detail page's graphs (plan 070). Every
 * function here takes data the page already has (the last 100 deliveries,
 * newest first, and the webhook's own config) and returns numbers the
 * components render — no fetching, no React. Kept separate from the
 * components so the numbers in a flag graph's header can be tested against
 * the doctor's evidence directly, and never drift from it.
 *
 * `DeliveryRow[]` inputs are newest-first, matching `GET /:id/deliveries`.
 */

// ── Last 100 attempts ribbon ─────────────────────────────────────────

export type RibbonStatus = "ok" | "rate_limited" | "failed";

export interface RibbonCell {
	status: RibbonStatus;
	/** "attempt 42 · 502 · 61 ms" — the cell's `title`. */
	label: string;
}

export interface RibbonSummary {
	cells: RibbonCell[];
	/** "100 of 100 ok", or "77 ok · 23 failed" — zero-valued parts are
	 *  dropped, not shown as "0 rate-limited". */
	summary: string;
}

function ribbonStatus(row: DeliveryRow): RibbonStatus {
	if (row.statusCode === 429) return "rate_limited";
	if (
		row.statusCode !== null &&
		row.statusCode >= 200 &&
		row.statusCode < 300
	) {
		return "ok";
	}
	return "failed";
}

/** Ribbon cells oldest → newest (left to right), and the summary line. */
export function ribbonCells(rows: DeliveryRow[]): RibbonSummary {
	const ordered = [...rows].reverse();
	let ok = 0;
	let failed = 0;
	let rateLimited = 0;

	const cells = ordered.map((row, i) => {
		const status = ribbonStatus(row);
		if (status === "ok") ok += 1;
		else if (status === "rate_limited") rateLimited += 1;
		else failed += 1;

		const code =
			row.statusCode === null ? "no response" : String(row.statusCode);
		const duration = row.durationMs === null ? "" : ` · ${row.durationMs} ms`;
		return { status, label: `attempt ${i + 1} · ${code}${duration}` };
	});

	const summary =
		ok === ordered.length
			? `${ok} of ${ordered.length} ok`
			: [
					`${ok} ok`,
					failed > 0 ? `${failed} failed` : null,
					rateLimited > 0 ? `${rateLimited} rate-limited` : null,
				]
					.filter((part): part is string => part !== null)
					.join(" · ");

	return { cells, summary };
}

// ── Events, last 7 days: header summary ──────────────────────────────

/** "1,204 events delivered", plus " · N waiting" and/or " · N gave up" only
 *  when either is non-zero — matching the locked mock exactly. */
export function activityHeaderSummary(hours: WebhookActivityHour[]): string {
	let delivered = 0;
	let waiting = 0;
	let gaveUp = 0;
	for (const hour of hours) {
		delivered += hour.delivered;
		waiting += hour.waiting;
		gaveUp += hour.gaveUp;
	}
	const parts = [`${delivered.toLocaleString("en-US")} events delivered`];
	if (waiting > 0) parts.push(`${waiting.toLocaleString("en-US")} waiting`);
	if (gaveUp > 0) parts.push(`${gaveUp.toLocaleString("en-US")} gave up`);
	return parts.join(" · ");
}

// ── Share of attempts answered 429, per hour ─────────────────────────

export interface HourlyRateLimitShare {
	/** ISO timestamp, UTC hour start. */
	hour: string;
	total: number;
	count429: number;
	/** 0-100. */
	sharePct: number;
}

/** ISO string truncated to its UTC hour start; input is always a `Z`-suffixed
 *  UTC timestamp (matching every other timestamp this app renders). */
function hourStartIso(iso: string): string {
	return `${iso.slice(0, 13)}:00:00.000Z`;
}

/** Buckets the given deliveries by their dispatch hour and the share that
 *  came back 429, oldest hour first. Only hours with at least one attempt
 *  appear — there's no zero-fill here, unlike the events chart. */
export function rateLimitedShareByHour(
	rows: DeliveryRow[],
): HourlyRateLimitShare[] {
	const byHour = new Map<string, { total: number; count429: number }>();
	for (const row of rows) {
		const hour = hourStartIso(row.dispatchedAt);
		const bucket = byHour.get(hour) ?? { total: 0, count429: 0 };
		bucket.total += 1;
		if (row.statusCode === 429) bucket.count429 += 1;
		byHour.set(hour, bucket);
	}
	return [...byHour.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([hour, { total, count429 }]) => ({
			hour,
			total,
			count429,
			sharePct: total === 0 ? 0 : (count429 / total) * 100,
		}));
}

// ── Response-time histogram ───────────────────────────────────────────

// Matches `receiver_slow`'s own window in `@secondlayer/sdk/webhooks/doctor`
// exactly, so this graph's median never disagrees with that detector's
// evidence for the same deliveries.
const SLOW_WINDOW = 20;
const HISTOGRAM_BINS = 20;

export interface HistogramBin {
	rangeStart: number;
	rangeEnd: number;
	count: number;
}

export interface ResponseTimeHistogram {
	bins: HistogramBin[];
	/** Median of the same newest-20 window `receiver_slow` evidence uses. */
	median: number;
	sampleCount: number;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** 20 bins from 0 to `timeoutMs`, over the newest 20 attempts with a known
 *  duration — the same window `receiver_slow` medians over. */
export function responseTimeHistogram(
	rows: DeliveryRow[],
	timeoutMs: number,
): ResponseTimeHistogram {
	const durations = rows
		.slice(0, SLOW_WINDOW)
		.map((row) => row.durationMs)
		.filter((ms): ms is number => ms !== null);

	const binWidth = timeoutMs / HISTOGRAM_BINS;
	const bins: HistogramBin[] = Array.from(
		{ length: HISTOGRAM_BINS },
		(_, i) => ({
			rangeStart: i * binWidth,
			rangeEnd: (i + 1) * binWidth,
			count: 0,
		}),
	);
	for (const ms of durations) {
		const idx =
			binWidth > 0
				? Math.min(HISTOGRAM_BINS - 1, Math.floor(ms / binWidth))
				: 0;
		const bin = bins[idx];
		if (bin) bin.count += 1;
	}

	return { bins, median: median(durations), sampleCount: durations.length };
}

// ── Block → delivery lag ──────────────────────────────────────────────

const LAG_POINTS = 40;

export interface LagPoint {
	dispatchedAt: string;
	lagMs: number;
}

/** Seconds between a block and its delivery, for the newest 40 events with a
 *  known block time, oldest → newest (left to right). Rows without a block
 *  time (test deliveries, compacted outbox rows) are skipped, not zero. */
export function deliveryLagSeries(rows: DeliveryRow[]): LagPoint[] {
	const withBlockTime = rows.filter(
		(row): row is DeliveryRow & { blockTime: string } => row.blockTime !== null,
	);
	return withBlockTime
		.slice(0, LAG_POINTS)
		.map((row) => ({
			dispatchedAt: row.dispatchedAt,
			lagMs:
				new Date(row.dispatchedAt).getTime() -
				new Date(row.blockTime).getTime(),
		}))
		.reverse();
}

// ── Shared date/time formatting (flag graphs + their evidence) ───────

/** "2026-04-23 14:06 UTC" — matches the doctor's own evidence formatting
 *  (`@secondlayer/sdk/webhooks/doctor`'s `formatShortDate`), so a value we
 *  add here never reads differently from one the detector already prints. */
export function formatUtcDateTime(iso: string): string {
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** "14:06 UTC" — the axis-label form, no date. */
export function formatUtcTime(iso: string): string {
	return `${iso.slice(11, 16)} UTC`;
}

// ── receiver_down: events waiting since the last success ─────────────

export interface WaitingSeriesPoint {
	/** Unix seconds. */
	time: number;
	value: number;
}

const MIN_LIVELINE_WINDOW_SECS = 30;

/** The `receiver_down` flag graph's line: a rise from `lastSuccessAt` to now,
 *  seeded on mount from `/activity`'s hourly `waiting` counts (so the graph
 *  shows the climb on first paint, not just this session's live polls), then
 *  continued with the real 5s polls in `waitingHistory`.
 *
 *  The hourly counts are a coarse proxy for a continuous backlog curve, so
 *  they're scaled to land exactly on the current `waiting` figure — the same
 *  number the evidence line above the graph shows. Seed and live points can
 *  collide at the boundary (the seed's last hour and the first live poll
 *  landing in the same second); the live, real reading wins on a tie.
 *
 *  Liveline's own `window` prop defaults to 30s, which would clip this
 *  entire seeded rise — `windowSecs` here is sized to the full span so the
 *  caller can pass it straight through. */
export function receiverDownWaitingSeries(
	activity: WebhookActivity,
	waitingHistory: { t: number; waiting: number }[],
	nowMs: number,
): { points: WaitingSeriesPoint[]; windowSecs: number } {
	const livePoints: WaitingSeriesPoint[] = waitingHistory.map((p) => ({
		time: Math.floor(p.t / 1000),
		value: p.waiting,
	}));

	const seedPoints: WaitingSeriesPoint[] = [];
	if (activity.lastSuccessAt) {
		const lastSuccessMs = new Date(activity.lastSuccessAt).getTime();
		const relevant = activity.hours.filter((h) => {
			const hourStartMs = new Date(h.hour).getTime();
			return hourStartMs + 3_600_000 > lastSuccessMs;
		});

		let cumulative = 0;
		const raw = relevant.map((h) => {
			cumulative += h.waiting;
			return {
				time: Math.floor(new Date(h.hour).getTime() / 1000),
				value: cumulative,
			};
		});
		const rawTotal = raw[raw.length - 1]?.value ?? 0;
		const scale = rawTotal > 0 ? activity.waiting / rawTotal : 0;
		seedPoints.push(
			...raw.map((p) => ({ time: p.time, value: p.value * scale })),
		);
	}

	// Concatenate then drop an earlier point whenever the next one shares its
	// timestamp (the seed/live boundary is the only place this happens) — a
	// duplicate x value is what breaks the line into two segments.
	const merged = [...seedPoints, ...livePoints];
	const points: WaitingSeriesPoint[] = [];
	for (let i = 0; i < merged.length; i++) {
		const point = merged[i];
		const next = merged[i + 1];
		if (point && next && point.time === next.time) continue;
		if (point) points.push(point);
	}

	const nowSec = Math.floor(nowMs / 1000);
	const earliest = points[0]?.time ?? nowSec;
	const windowSecs = Math.max(MIN_LIVELINE_WINDOW_SECS, nowSec - earliest);

	return { points, windowSecs };
}

// ── Catch-up bar ───────────────────────────────────────────────────────

export interface CatchUpPoll {
	/** `Date.now()`-style ms timestamp. */
	t: number;
	waiting: number;
}

export interface CatchUpState {
	/** 0-1. */
	progress: number;
	/** Events per minute, from the last 3 polls. 0 when it can't be measured
	 *  yet, or the queue isn't shrinking. */
	ratePerMin: number;
	/** `null` when `ratePerMin` is 0 — there's nothing to estimate from. */
	etaMinutes: number | null;
	sentSoFar: number;
	peak: number;
	waiting: number;
}

/** `peak` is the highest `waiting` seen this page session; `history` is the
 *  session's polls of `/activity`, oldest first. */
export function catchUpState(
	peak: number,
	waiting: number,
	history: CatchUpPoll[],
): CatchUpState {
	const progress = peak > 0 ? (peak - waiting) / peak : 0;
	const sentSoFar = Math.max(0, peak - waiting);

	const recent = history.slice(-3);
	let ratePerMin = 0;
	if (recent.length >= 2) {
		const first = recent[0];
		const last = recent[recent.length - 1];
		if (first && last) {
			const dtMin = (last.t - first.t) / 60_000;
			const drained = first.waiting - last.waiting;
			ratePerMin = dtMin > 0 ? Math.max(0, drained / dtMin) : 0;
		}
	}
	const etaMinutes = ratePerMin > 0 ? Math.ceil(waiting / ratePerMin) : null;

	return { progress, ratePerMin, etaMinutes, sentSoFar, peak, waiting };
}

/** "1,240 events left, about 3 min at 410 a minute. 3,860 of 5,100 sent so
 *  far, oldest first." — or just "N events left." when the rate can't be
 *  measured (no ETA to give). */
export function catchUpCopy(state: CatchUpState): string {
	const left = `${state.waiting.toLocaleString("en-US")} event${
		state.waiting === 1 ? "" : "s"
	} left`;
	if (state.etaMinutes === null) return `${left}.`;
	const rate = Math.round(state.ratePerMin).toLocaleString("en-US");
	return (
		`${left}, about ${state.etaMinutes} min at ${rate} a minute. ` +
		`${state.sentSoFar.toLocaleString("en-US")} of ${state.peak.toLocaleString("en-US")} sent so far, oldest first.`
	);
}
