import { formatUsd } from "@/lib/account-data";
import { type Insight, rankInsights } from "@/lib/insights";
import { type RowsResponse, hourlyPoints } from "@/lib/rows";
import type { ApiKey } from "@/lib/types";
import {
	type Burn,
	type HostedStack,
	ROWS_ALLOWANCE,
	formatRows,
	latestMemoryHour,
} from "@/lib/usage";
import { countedKeys, overviewKeys, staleKeys } from "../keys/key-view";
import { ageShort } from "../webhooks/view";

/**
 * Which cell of the strip an account insight is about. An insight sits in the
 * cell it is about; money insights (spend cap, credits runway) stay above the
 * month panel, so they are not listed here.
 */
export const CELL_RULES = { rows: ["server_errors"] } as const;

/** Splits account insights into the ones the Rows cell carries and the rest. */
export function cellInsights(insights: readonly Insight[]): {
	rows: Insight[];
	rest: Insight[];
} {
	const ranked = rankInsights(insights);
	const inRows = (i: Insight) =>
		(CELL_RULES.rows as readonly string[]).includes(i.rule);
	return {
		rows: ranked.filter(inRows),
		rest: ranked.filter((i) => !inRows(i)),
	};
}

export interface RowsCell {
	monthLabel: string;
	/** Rows delivered this month, free and paid together. */
	used: number;
	/** The part of `used` inside the free 1M. */
	free: number;
	/** The part of `used` past the free 1M. */
	paid: number;
	/** Rows delivered since midnight UTC. */
	today: number;
	caption: string;
	/** When the last read landed, short ("1h"), or "–". */
	age: string;
}

/**
 * The Rows cell: this month's meter split into free and paid, today's count,
 * and how long ago the last read landed.
 */
export function rowsCell(data: RowsResponse, now: Date): RowsCell {
	const used = data.allowance.usedThisMonth;
	const free = Math.min(used, ROWS_ALLOWANCE);
	const paid = Math.max(0, used - ROWS_ALLOWANCE);
	const today = hourlyPoints(data.hourlyToday, now).reduce((a, b) => a + b, 0);
	const lastHour = data.hourlyToday.at(-1)?.hour ?? null;
	return {
		monthLabel: now.toLocaleDateString("en-US", {
			month: "long",
			timeZone: "UTC",
		}),
		used,
		free,
		paid,
		today,
		caption:
			paid > 0
				? `Free 1M used up · ${formatRows(paid)} paid · ${formatRows(today)} today`
				: `${formatRows(used)} of 1M free · ${formatRows(today)} today`,
		age: ageShort(lastHour),
	};
}

/** How many days the Keys cell's strip covers. */
const KEY_DAYS = 24;

export interface KeysCell {
	/** The keys read most recently (up to two), then "+N" for the rest. */
	names: string[];
	/** Rows read per day, oldest first; zeros when the API sent no series. */
	days: number[];
	/** How many of those days any key read. */
	daysRead: number;
	caption: string;
	age: string;
	/** The longest-unused key, once it has been idle 30+ days. */
	stale: { name: string; days: number } | null;
}

/** The Keys cell; null when the account has no keys of its own. */
export function keysCell(keys: ApiKey[] | null, now: Date): KeysCell | null {
	const view = overviewKeys(keys, now);
	if (!view) return null;
	const counted = countedKeys(keys, now);
	const byRecentRead = [...counted].sort(
		(a, b) => Date.parse(b.lastUsedAt ?? "") - Date.parse(a.lastUsedAt ?? ""),
	);
	const shown = byRecentRead.slice(0, 2).map((k) => k.name);
	const more = counted.length - shown.length;
	const days = view.spark ?? new Array<number>(KEY_DAYS).fill(0);
	const daysRead = days.filter((n) => n > 0).length;
	const stale = staleKeys(counted, now)[0];
	return {
		names: more > 0 ? [...shown, `+${more}`] : shown,
		days,
		daysRead,
		caption: `${counted.length} ${counted.length === 1 ? "key" : "keys"} · read on ${daysRead} of the last ${KEY_DAYS} days`,
		age: view.age,
		stale: stale ? { name: stale.key.name, days: stale.days } : null,
	};
}

export interface StackCell {
	/** ok shows no dot; alarm is stopped; idle is not started. */
	tone: "ok" | "alarm" | "idle";
	word: "running" | "stopped" | "not started";
	/** Cost per day ("$0.33"), or null while the burn rate has not loaded. */
	perDay: string | null;
	/** Latest memory in GB, two decimals, or null before any hour is recorded. */
	gb: string | null;
	/** Memory per hour, last 24 hours. */
	points: number[];
	caption: string;
}

/** The hosted stack cell; null until the usage response has loaded. */
export function stackCell(
	stack: HostedStack | null,
	burn: Burn | null,
): StackCell | null {
	if (!stack) return null;
	const latest = latestMemoryHour(stack.memory24h);
	const gb = latest ? (latest.observedGb ?? latest.billedGb).toFixed(2) : null;
	const points = stack.memory24h.map((m) => m.observedGb ?? m.billedGb);
	if (stack.state === "none") {
		return {
			tone: "idle",
			word: "not started",
			perDay: "$0.00",
			gb: null,
			points: [],
			caption: "Starts with your first webhook.",
		};
	}
	if (stack.state === "stopped") {
		return {
			tone: "alarm",
			word: "stopped",
			// Stopped, so nothing is charging, whatever the last 24 hours burned.
			perDay: "$0.00",
			gb,
			points,
			caption: "Add credits to start it again.",
		};
	}
	return {
		tone: "ok",
		word: "running",
		perDay: burn ? formatUsd(burn.rateDayUsdMicros) : null,
		gb,
		points,
		caption: `${gb ? `${gb} GB · ` : ""}runs your webhooks`,
	};
}
