"use client";

import { LazyContextLineChart } from "@/components/charts/lazy";
import { dailyBuckets } from "@/lib/subgraph-view";
import type {
	SubgraphErrorGroup,
	SubgraphHealthHour,
} from "@/lib/subgraphs-store";
import { formatRelative } from "@/lib/webhooks-data";
import { utcClock } from "../webhooks/view";

const DAY_MS = 86_400_000;

/** Tick labels for a window of hourly points: the start, the middle and now. */
export function hourLabels(count: number): [number, string][] {
	if (count < 2) return [];
	const middle = Math.floor((count - 1) / 2);
	return [
		[0, `-${count}h`],
		[middle, `-${count - 1 - middle}h`],
		[count - 1, "now"],
	];
}

/** Tick labels for a window of daily points: the start, the middle and now. */
export function dayLabels(count: number): [number, string][] {
	if (count < 2) return [];
	const middle = Math.floor((count - 1) / 2);
	return [
		[0, `-${count}d`],
		[middle, `-${count - 1 - middle}d`],
		[count - 1, "now"],
	];
}

/** Tooltip heading per hourly point: "14:00 UTC". */
export function hourPointLabels(
	hours: readonly SubgraphHealthHour[],
): string[] {
	return hours.map((h) => `${utcClock(h.hour)} UTC`);
}

export type RowsRange = "24h" | "7d";

/** "Oct 14": a day's heading in the 7-day tooltip. */
const dayLabel = (iso: string): string =>
	new Date(iso).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});

/** Rows the subgraph wrote: per hour over 24h, per day over 7d. */
export function RowsWrittenPanel({
	hours,
	range,
}: {
	hours: readonly SubgraphHealthHour[];
	range: RowsRange;
}) {
	const known = hours.some((h) => h.lagBlocks !== null);
	const days = range === "7d" ? dailyBuckets(hours) : null;
	const values = days
		? days.map((d) => d.rowsWritten)
		: hours.map((h) => h.rowsWritten);
	return (
		<section className="dash-panel bl-panel" aria-label="Rows written">
			<span className="dash-label">Rows written · {range}</span>
			{known ? (
				<div className="dc-chart">
					<LazyContextLineChart
						context={[]}
						values={values}
						contextName=""
						valueName="Rows written"
						height={150}
						xLabels={days ? dayLabels(days.length) : hourLabels(hours.length)}
						pointLabels={
							days ? days.map((d) => dayLabel(d.start)) : hourPointLabels(hours)
						}
					/>
				</div>
			) : (
				<p className="bl-note">No history yet. It fills in hour by hour.</p>
			)}
		</section>
	);
}

/** Handler errors seen in the last 24 hours, grouped by message and frame. */
export function HandlerErrorsPanel({
	groups,
	now = Date.now(),
}: {
	groups: readonly SubgraphErrorGroup[];
	now?: number;
}) {
	const recent = groups.filter(
		(g) => now - new Date(g.lastSeen).getTime() <= DAY_MS,
	);
	if (recent.length === 0) return null;
	return (
		<section
			className="dash-panel bl-panel sg-errors"
			aria-label="Handler errors"
		>
			<span className="dash-label">Handler errors · 24h</span>
			<div className="wd-tbl-wrap">
				<table className="wd-tbl">
					<thead>
						<tr>
							<th>Error</th>
							<th>Event</th>
							<th className="r">Count</th>
							<th className="r">Last seen</th>
						</tr>
					</thead>
					<tbody>
						{recent.map((g) => (
							<tr key={`${g.message}-${g.frame ?? ""}-${g.eventType ?? ""}`}>
								<td className="sg-err">
									<span className="bad">{g.message}</span>
									{g.frame ? (
										<span className="wd-faint"> · {g.frame}</span>
									) : null}
								</td>
								<td>{g.eventType ?? "–"}</td>
								<td className="r">{g.count.toLocaleString("en-US")}</td>
								<td className="r">{formatRelative(g.lastSeen, now)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
