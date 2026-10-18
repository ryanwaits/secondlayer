"use client";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { LazyBandBarChart } from "@/components/charts/lazy";
import { Legend } from "@/components/dashboard/charts/legend";
import { barsRows } from "@/lib/dashboard-charts";
import type { WebhookActivityDay } from "@/lib/webhooks-data";
import type { WebhookActivity } from "@secondlayer/sdk";
import { type Range, outageStartIndex, rangeBars, utcClock } from "./view";

const BAND_NOTE =
	'No "usual range" band: under 1 event an hour is too little to call anything unusual. The band shows up once there\'s enough volume.';

export function DeliveriesChart({
	activity,
	days,
	range,
	losing,
}: {
	activity: WebhookActivity;
	days: readonly WebhookActivityDay[] | undefined;
	range: Range;
	/** A losing insight is on the page, so mark where the outage began. */
	losing: boolean;
}) {
	const bars = rangeBars(range, activity, days);
	const hourly = range !== "30d";
	const outage = losing ? outageStartIndex(activity.hours) : null;
	const outageHour = outage === null ? undefined : activity.hours[outage]?.hour;
	const markIndex = outage === null ? -1 : outage - bars.offset;
	const mark =
		hourly && outageHour && markIndex >= 0
			? { index: markIndex, label: `Failures start ${utcClock(outageHour)}` }
			: undefined;
	const showBandNote = range !== "7d" && hourly && !activity.usualByHourOfDay;
	return (
		<section className="dash-panel" aria-label="Deliveries">
			<div className="dash-panel-h">
				<span className="dash-label">
					Deliveries per {hourly ? "hour" : "day"}
				</span>
				<Legend
					items={[
						{
							swatch: "square",
							label: "Delivered",
							color: "var(--ch-a)",
						},
						{ swatch: "square", label: "Failed" },
						...(bars.band
							? [{ swatch: "band" as const, label: "Usual for this hour" }]
							: []),
					]}
				/>
			</div>
			{bars.rows.length === 0 ? (
				<ChartSkeleton height={180} />
			) : (
				<LazyBandBarChart
					rows={barsRows(bars.rows, { band: bars.band ?? undefined })}
					height={180}
					xLabels={bars.labels}
					pointLabels={bars.pointLabels}
					mark={mark}
					seriesNames={{ n: "Delivered", p: "", f: "Failed" }}
				/>
			)}
			{showBandNote ? <span className="wd-faint">{BAND_NOTE}</span> : null}
		</section>
	);
}
