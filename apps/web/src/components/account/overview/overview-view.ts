import { formatUsd } from "@/lib/account-data";
import { type Insight, rankInsights } from "@/lib/insights";
import { type RowsResponse, hourlyPoints } from "@/lib/rows";
import { type StackStatus, stackStatus } from "@/lib/stack-status";
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

export interface RowsCell {
	monthLabel: string;
	used: number;
	free: number;
	paid: number;
	today: number;
	caption: string;
	age: string;
}

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

const KEY_DAYS = 24;

export interface KeysCell {
	names: string[];
	days: number[];
	daysRead: number;
	caption: string;
	age: string;
	stale: { name: string; days: number } | null;
}

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

export interface StackContext {
	asleep: boolean;
	creditsUsdMicros: string | null;
}

export function overviewStackStatus(
	stack: HostedStack,
	{ asleep, creditsUsdMicros }: StackContext,
): StackStatus | null {
	return stackStatus({
		service: stack.state,
		stack: stack.stack,
		read: { kind: asleep ? "asleep" : "ok" },
		creditsUsdMicros,
	});
}

export interface StackCell {
	tone: "ok" | "alarm" | "idle";
	word: "running" | "stopped" | "asleep" | "starting" | "not started";
	perDay: string | null;
	gb: string | null;
	points: number[];
	caption: string;
}

export function stackCell(
	stack: HostedStack | null,
	burn: Burn | null,
	context: StackContext,
): StackCell | null {
	if (!stack) return null;
	const latest = latestMemoryHour(stack.memory24h);
	const gb = latest ? (latest.observedGb ?? latest.billedGb).toFixed(2) : null;
	const points = stack.memory24h.map((m) => m.observedGb ?? m.billedGb);
	const status = overviewStackStatus(stack, context);
	switch (status) {
		case "none":
			return {
				tone: "idle",
				word: "not started",
				perDay: "$0.00",
				gb: null,
				points: [],
				caption: "Starts with your first webhook.",
			};
		case "stopped_no_credits":
			return {
				tone: "alarm",
				word: "stopped",
				perDay: "$0.00",
				gb,
				points,
				caption: "Add credits to start it again.",
			};
		case "stopped_other":
			return {
				tone: "alarm",
				word: "stopped",
				perDay: "$0.00",
				gb,
				points,
				caption: "Check your credits.",
			};
		case "asleep":
		case "waking":
			return {
				tone: "idle",
				word: "asleep",
				perDay: "$0.00",
				gb,
				points,
				caption: "Every webhook is paused, so it isn't billed.",
			};
		// Credits are there and webhooks aren't paused: the 5-minute credits
		// poll (or the next request) restarts it, and this state can also lag a
		// restart that already happened, since it is read from hourly billing.
		case "starting":
			return {
				tone: "idle",
				word: "starting",
				perDay: "$0.00",
				gb,
				points,
				caption: "Starts again on its own within a few minutes.",
			};
		default:
			break;
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
