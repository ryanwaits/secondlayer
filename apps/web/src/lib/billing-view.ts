/**
 * Pure view helpers for the Billing screen: the spend line and its
 * projection, the per-day cost split, the by-unit
 * table. No React, no fetch. Money stays in USD-micros strings until a value
 * is shaped for display or a chart.
 */

import { spendProjection } from "./dashboard-charts";
import type { CreditAdded } from "./types";
import {
	type DailySpend,
	ROWS_ALLOWANCE,
	type UsageRow,
	currentUtcMonth,
	daysInUtcMonth,
	formatRows,
	nextMonthLabel,
} from "./usage";

const MICROS = 1_000_000;

/** Units Sentinel meters per run. They are not part of the spend line. */
export function isSentinelUnit(unit: string): boolean {
	return unit.startsWith("sentinel.");
}

/** "$6.21": USD-micros (or dollars as a number of micros) to two decimals. */
export function dollars(usd: number): string {
	return `$${usd.toFixed(2)}`;
}

/** The custom cap box: whole dollars above zero, or `null` (no cap). */
export function parseCapInput(text: string): number | null {
	const trimmed = text.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number(trimmed);
	return value > 0 && Number.isSafeInteger(value) ? value : null;
}

/** A cap in cents back to whole dollars for the control, or `null`. */
export function capDollars(monthlyCapCents: number | null): number | null {
	return monthlyCapCents == null ? null : Math.round(monthlyCapCents / 100);
}

/** Daily spend in USD for each UTC day of `now`'s month through `now`'s day,
 *  Sentinel excluded, days with no charge as 0. */
export function monthSpendSeries(daily: DailySpend[], now: Date): number[] {
	const days = now.getUTCDate();
	const monthPrefix = now.toISOString().slice(0, 7);
	const series = new Array<number>(days).fill(0);
	for (const row of daily) {
		if (isSentinelUnit(row.unit) || !row.date.startsWith(monthPrefix)) continue;
		const index = Number(row.date.slice(8, 10)) - 1;
		if (index >= 0 && index < days) {
			series[index] = (series[index] ?? 0) + Number(row.usdMicros) / MICROS;
		}
	}
	return series;
}

/** The spend line's totals: spent so far, the mean of the last 7 days, and
 *  where the month ends up at that pace. */
export function monthProjection(daily: DailySpend[], now: Date) {
	const series = monthSpendSeries(daily, now);
	const daysInMonth = daysInUtcMonth(currentUtcMonth(now));
	return { series, daysInMonth, ...spendProjection(series, daysInMonth) };
}

export type CostDay = {
	/** "Oct 1" */
	day: string;
	stack: number;
	rows: number;
	events: number;
};

/** Cost per day, split into the hosted stack, rows, and webhook events plus
 *  storage. Sentinel and other units are not part of this split. */
export function costByDay(daily: DailySpend[], now: Date): CostDay[] {
	const days = now.getUTCDate();
	const monthPrefix = now.toISOString().slice(0, 7);
	const month = now.toLocaleDateString("en-US", {
		month: "short",
		timeZone: "UTC",
	});
	const out: CostDay[] = Array.from({ length: days }, (_, i) => ({
		day: `${month} ${i + 1}`,
		stack: 0,
		rows: 0,
		events: 0,
	}));
	for (const row of daily) {
		if (!row.date.startsWith(monthPrefix)) continue;
		const slot = out[Number(row.date.slice(8, 10)) - 1];
		if (!slot) continue;
		const usd = Number(row.usdMicros) / MICROS;
		if (row.unit === "memory.gb_hour") slot.stack += usd;
		else if (row.unit === "rows.delivered") slot.rows += usd;
		else if (row.unit === "webhook.event" || row.unit === "storage.gb_day")
			slot.events += usd;
	}
	return out;
}

export interface UnitLine {
	unit: string;
	usdMicros: string;
	quantity: string;
	sentinel: boolean;
}

/** The by-unit rows for the month: charges only (top-ups and grants carry
 *  negative micros), the hosted units first and Sentinel's last. */
export function unitLines(usage: UsageRow[]): UnitLine[] {
	return usage
		.filter((u) => Number(u.usdMicros) >= 0)
		.map((u) => ({
			unit: u.unit,
			usdMicros: u.usdMicros,
			quantity: u.quantity,
			sentinel: isSentinelUnit(u.unit),
		}))
		.sort((a, b) => Number(a.sentinel) - Number(b.sentinel));
}

/** Sum of the lines' micros, as a bigint-safe total string. */
export function totalMicros(lines: readonly { usdMicros: string }[]): string {
	return lines.reduce((sum, l) => sum + BigInt(l.usdMicros), 0n).toString();
}

/** What a credits-added row says: "Top-up", or "Credit" for a grant. */
export function creditWhat(credit: CreditAdded): string {
	return credit.kind === "topup" ? "Top-up" : "Credit";
}

/** "10-09": month and day, UTC. */
export function creditDate(iso: string): string {
	return iso.slice(5, 10);
}
