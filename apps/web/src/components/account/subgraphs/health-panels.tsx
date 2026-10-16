"use client";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import {
	LazyBandBarChart,
	LazyContextLineChart,
} from "@/components/charts/lazy";
import { barsRows } from "@/lib/dashboard-charts";
import type {
	SubgraphErrorGroup,
	SubgraphHealthHour,
} from "@/lib/subgraphs-store";
import { formatRelative } from "@/lib/webhooks-data";

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

/** Blocks behind the tip, per hour. Under two blocks counts as live. */
export function BlocksBehindPanel({
	hours,
}: { hours: readonly SubgraphHealthHour[] }) {
	const known = hours.some((h) => h.lagBlocks !== null);
	return (
		<section className="dash-panel bl-panel" aria-label="Blocks behind tip">
			<span className="dash-label">Blocks behind tip · 24h</span>
			{known ? (
				<div className="dc-chart">
					<LazyBandBarChart
						rows={barsRows(hours.map((h) => ({ n: h.lagBlocks ?? 0 })))}
						height={150}
						xLabels={hourLabels(hours.length)}
						seriesNames={{ n: "Blocks behind", p: "", f: "" }}
					/>
				</div>
			) : (
				<p className="bl-note">No history yet. It fills in hour by hour.</p>
			)}
			<span className="bl-note">Under 2 blocks counts as live.</span>
		</section>
	);
}

/** Rows the subgraph wrote, per hour. */
export function RowsWrittenPanel({
	hours,
}: { hours: readonly SubgraphHealthHour[] }) {
	const known = hours.some((h) => h.lagBlocks !== null);
	return (
		<section className="dash-panel bl-panel" aria-label="Rows written per hour">
			<span className="dash-label">Rows written per hour · 24h</span>
			{known ? (
				<div className="dc-chart">
					<LazyContextLineChart
						context={[]}
						values={hours.map((h) => h.rowsWritten)}
						contextName=""
						valueName="Rows written"
						height={150}
						xLabels={hourLabels(hours.length)}
					/>
				</div>
			) : (
				<p className="bl-note">No history yet. It fills in hour by hour.</p>
			)}
		</section>
	);
}

export function HealthPanelsSkeleton() {
	return (
		<div className="bl-two even">
			<ChartSkeleton height={150} />
			<ChartSkeleton height={150} />
		</div>
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
