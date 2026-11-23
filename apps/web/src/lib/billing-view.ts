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

export function isSentinelUnit(unit: string): boolean {
	return unit.startsWith("sentinel.");
}

export function dollars(usd: number): string {
	return `$${usd.toFixed(2)}`;
}

export function parseCapInput(text: string): number | null {
	const trimmed = text.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number(trimmed);
	return value > 0 && Number.isSafeInteger(value) ? value : null;
}

export function capDollars(monthlyCapCents: number | null): number | null {
	return monthlyCapCents == null ? null : Math.round(monthlyCapCents / 100);
}

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

export function monthProjection(daily: DailySpend[], now: Date) {
	const series = monthSpendSeries(daily, now);
	const daysInMonth = daysInUtcMonth(currentUtcMonth(now));
	return { series, daysInMonth, ...spendProjection(series, daysInMonth) };
}

export interface UnitLine {
	unit: string;
	usdMicros: string;
	quantity: string;
	sentinel: boolean;
}

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

export function totalMicros(lines: readonly { usdMicros: string }[]): string {
	return lines.reduce((sum, l) => sum + BigInt(l.usdMicros), 0n).toString();
}

export function creditWhat(credit: CreditAdded): string {
	return credit.kind === "topup" ? "Top-up" : "Credit";
}

export function creditDate(iso: string): string {
	return new Date(iso).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}
