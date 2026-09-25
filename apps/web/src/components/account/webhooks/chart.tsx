"use client";

import { isSuccessDelivery } from "@/lib/webhooks-data";
import type { DeliveryRow } from "@secondlayer/sdk";
import {
	type AttemptBar,
	MonoRoundedBarChart,
} from "./charts/mono-rounded-bar-chart";

const MAX_MS = 2000;

/** The API returns rows newest first; the chart reads oldest → latest, left
 *  to right, so it's reversed here before handing off to the bar chart. */
export function AttemptsChart({ rows }: { rows: DeliveryRow[] }) {
	const ordered = [...rows].reverse();
	const bars: AttemptBar[] = ordered.map((d, i) => ({
		label: String(i),
		durationMs: Math.min(d.durationMs ?? MAX_MS, MAX_MS),
		ok: isSuccessDelivery(d),
	}));
	return (
		<>
			<MonoRoundedBarChart data={bars} maxMs={MAX_MS} height={120} />
			<div className="wh-chart-ends">
				<span>oldest</span>
				<span>latest</span>
			</div>
		</>
	);
}

export function medianOkDurationMs(rows: DeliveryRow[]): number {
	const durations = rows
		.filter(isSuccessDelivery)
		.map((r) => r.durationMs ?? 0)
		.sort((a, b) => a - b);
	if (durations.length === 0) return 0;
	return durations[Math.floor(durations.length / 2)] ?? 0;
}
