import type { WebhooksResult } from "@/lib/dashboard-results";
import type { Tone } from "@/lib/tone";
import { type WebhookActivityDay, formatRelative } from "@/lib/webhooks-data";
import type {
	DeliveryRow,
	WebhookActivity,
	WebhookSummary,
} from "@secondlayer/sdk";
import { pauseReasonOf } from "@secondlayer/shared/webhooks/health";
import { displayStatus } from "./shared";

const HOUR_MS = 3_600_000;

export interface HourlySeries {
	delivered: number[];
	failed: number[];
}

export interface RowState {
	tone: Tone;
	text: string;
	bad: boolean;
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

export function last24(series: HourlySeries | undefined): {
	delivered: number[];
	failed: number[];
} {
	return {
		delivered: series?.delivered.slice(-24) ?? [],
		failed: series?.failed.slice(-24) ?? [],
	};
}

export function utcClock(iso: string): string {
	return new Date(iso).toISOString().slice(11, 16);
}

export function outageStartIndex(
	hours: readonly { delivered: number; failed: number }[],
): number | null {
	let end = hours.length - 1;
	while (end >= 0 && hours[end]?.delivered === 0 && hours[end]?.failed === 0) {
		end--;
	}
	let start: number | null = null;
	for (let i = end; i >= 0; i--) {
		const hour = hours[i];
		if (!hour || hour.delivered > 0 || hour.failed === 0) break;
		start = i;
	}
	return start;
}

export function listRowState(
	webhook: WebhookSummary,
	series: HourlySeries | undefined,
	hours: readonly string[],
	pending = false,
): RowState {
	const recent = last24(series);
	const delivered = sum(recent.delivered);
	const failed = sum(recent.failed);

	const shown = displayStatus(webhook);
	if (shown === "paused") return { tone: "idle", text: "Paused", bad: false };

	if (series) {
		const tail = Math.min(48, series.delivered.length);
		const offset = series.delivered.length - tail;
		const window = Array.from({ length: tail }, (_, i) => ({
			delivered: series.delivered[offset + i] ?? 0,
			failed: series.failed[offset + i] ?? 0,
		}));
		const start = outageStartIndex(window);
		const startHour = start === null ? undefined : hours[offset + start];
		if (start !== null && startHour) {
			const lost = sum(window.slice(start).map((h) => h.failed));
			return {
				tone: "alarm",
				text: `Failing since ${utcClock(startHour)} UTC · ${lost.toLocaleString("en-US")} attempts failed`,
				bad: true,
			};
		}
	}

	if (shown === "error") {
		return {
			tone: "alarm",
			text:
				pauseReasonOf(webhook) === "circuit"
					? "Paused by the circuit breaker after repeated failures"
					: `Receiver failing · ${webhook.circuitFailures} failures in a row`,
			bad: true,
		};
	}
	if (pending && !series)
		return { tone: "idle", text: "Counting…", bad: false };
	if (delivered === 0 && failed === 0) {
		return {
			tone: "ok",
			text: `Nothing in the last 24h · last delivery ${formatRelative(webhook.lastDeliveryAt)}`,
			bad: false,
		};
	}
	return {
		tone: "ok",
		text: `Delivered ${delivered.toLocaleString("en-US")} in 24h${
			failed > 0 ? ` · ${failed.toLocaleString("en-US")} attempts failed` : ""
		}`,
		bad: false,
	};
}

export function utcStamp(iso: string): string {
	return `${MONTH_DAY.format(new Date(iso))} ${iso.slice(11, 19)}`;
}

export function ageShort(iso: string | null): string {
	return iso ? formatRelative(iso).replace(" ago", "") : "–";
}

export type Range = "24h" | "48h" | "7d" | "30d";
export const RANGES: readonly Range[] = ["24h", "48h", "7d", "30d"];

export interface RangeBars {
	rows: { n: number; f: number }[];
	band: [number, number][] | null;
	labels: [number, string][];
	pointLabels: string[];
	offset: number;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", {
	weekday: "short",
	timeZone: "UTC",
});
const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

export function rangeBars(
	range: Range,
	activity: Pick<WebhookActivity, "hours" | "usualByHourOfDay">,
	days: readonly WebhookActivityDay[] | undefined,
): RangeBars {
	if (range === "30d") {
		const list = days ?? [];
		const last = list.length - 1;
		return {
			rows: list.map((d) => ({ n: d.delivered, f: d.failed })),
			band: null,
			labels: list.flatMap((d, i): [number, string][] =>
				(last - i) % 5 === 0
					? [[i, MONTH_DAY.format(new Date(`${d.day}T00:00:00Z`))]]
					: [],
			),
			pointLabels: list.map((d) =>
				MONTH_DAY.format(new Date(`${d.day}T00:00:00Z`)),
			),
			offset: 0,
		};
	}
	const length = range === "24h" ? 24 : range === "48h" ? 48 : 168;
	const hours = activity.hours.slice(-length);
	const offset = activity.hours.length - hours.length;
	const usual = activity.usualByHourOfDay;
	const band =
		usual && length <= 48
			? hours.map((h): [number, number] => {
					const range = usual[new Date(h.hour).getUTCHours()];
					return range ? [range.lo, range.hi] : [0, 0];
				})
			: null;
	let labels: [number, string][];
	if (range === "7d") {
		labels = hours.flatMap((h, i): [number, string][] =>
			new Date(h.hour).getUTCHours() === 0 && i > 0
				? [[i, WEEKDAY.format(new Date(h.hour))]]
				: [],
		);
	} else if (range === "48h") {
		labels = [
			[0, "-48h"],
			[24, "-24h"],
			[Math.max(0, hours.length - 1), "now"],
		];
	} else {
		labels = [
			[0, "-24h"],
			[12, "-12h"],
			[Math.max(0, hours.length - 1), "now"],
		];
	}
	return {
		rows: hours.map((h) => ({ n: h.delivered, f: h.failed })),
		band,
		labels,
		pointLabels: hours.map(
			(h) => `${WEEKDAY.format(new Date(h.hour))} ${utcClock(h.hour)} UTC`,
		),
		offset,
	};
}

export interface AttemptGroup {
	key: string;
	attempts: DeliveryRow[];
	latest: DeliveryRow;
}

export const VISIBLE_GROUPS = 10;

export const FIRST_DELIVERIES = 25;

export function groupAttempts(rows: readonly DeliveryRow[]): AttemptGroup[] {
	const groups = new Map<string, DeliveryRow[]>();
	for (const row of rows) {
		const key =
			row.blockHeight !== null && row.txId !== null && row.eventIndex !== null
				? `${row.blockHeight}:${row.txId}:${row.eventIndex}`
				: row.id;
		const list = groups.get(key);
		if (list) list.push(row);
		else groups.set(key, [row]);
	}
	return [...groups].map(([key, list]) => {
		const attempts = [...list].sort(
			(a, b) =>
				a.attempt - b.attempt ||
				Date.parse(a.dispatchedAt) - Date.parse(b.dispatchedAt),
		);
		return { key, attempts, latest: attempts.at(-1) as DeliveryRow };
	});
}

export function isOk(row: Pick<DeliveryRow, "statusCode">): boolean {
	return (
		row.statusCode !== null && row.statusCode >= 200 && row.statusCode < 300
	);
}

function percentile(sorted: readonly number[], p: number): number | null {
	if (sorted.length === 0) return null;
	const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
	return sorted[index] ?? null;
}

export function deliveryStats(rows: readonly DeliveryRow[]): {
	retried: number;
	p50: number | null;
	p95: number | null;
} {
	const durations = rows
		.filter((r) => isOk(r) && r.durationMs !== null)
		.map((r) => r.durationMs as number)
		.sort((a, b) => a - b);
	return {
		retried: rows.filter((r) => r.attempt > 1).length,
		p50: percentile(durations, 0.5),
		p95: percentile(durations, 0.95),
	};
}

const HOUR_LABEL = new Intl.DateTimeFormat("en-US", {
	weekday: "short",
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

export function hourWindow(
	param: string | null,
): { from: string; to: string; label: string } | null {
	if (!param) return null;
	const time = Date.parse(param);
	if (!Number.isFinite(time)) return null;
	const start = Math.floor(time / HOUR_MS) * HOUR_MS;
	const clock = (t: number) => new Date(t).toISOString().slice(11, 13);
	return {
		from: new Date(start).toISOString(),
		to: new Date(start + HOUR_MS).toISOString(),
		label: `${HOUR_LABEL.format(new Date(start))} · ${clock(start)}:00–${clock(start + HOUR_MS)}:00 UTC`,
	};
}

export function describeFailure(
	res: Exclude<WebhooksResult<unknown>, { kind: "ok" }>,
): string {
	if (res.kind === "rate_limited") {
		return `Too many requests. Try again in ${res.retryAfter}s.`;
	}
	if (res.kind === "starting") return "Your hosted stack is still starting.";
	if (res.kind === "no_credits") return "Add credits to do that.";
	if (res.kind === "asleep") return "Your hosted stack is asleep.";
	if (res.kind === "not_found") return "That webhook wasn't found.";
	return res.message;
}
