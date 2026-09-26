"use client";

// Adapted from Monocharts (MIT, github.com/Subhan-code/Monocharts)
// src/components/mono-charts/MonoRoundedBarChart.tsx — kept the rounded-bar,
// recharts-driven geometry; dropped Mono's own card chrome (header, layout
// switcher, `#181818`/neutral-* Tailwind) since `.wh-chart` already supplies
// that, themed with this app's own tokens instead. Stacked into three series
// (delivered/waiting/gave up) via recharts `stackId`, instead of Mono's
// single-series bars.

import { useEffect, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
} from "recharts";
import { WebhookChartTooltip } from "./recharts-tooltip";

export interface ActivityHourBar {
	hour: string;
	delivered: number;
	waiting: number;
	gaveUp: number;
}

function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);
	useEffect(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReduced(mq.matches);
		const onChange = () => setReduced(mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	return reduced;
}

/** One stacked bar per hour: delivered (`--fig-bar`), waiting (`--fig-role-a`),
 *  gave up (`--fig-alarm`). `data` is oldest → newest, left to right. */
export function MonoStackedBarChart({
	data,
	height = 120,
}: {
	data: ActivityHourBar[];
	height?: number;
}) {
	const reducedMotion = usePrefersReducedMotion();

	return (
		<ResponsiveContainer width="100%" height={height}>
			<BarChart
				data={data}
				margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
				barCategoryGap={1}
			>
				<CartesianGrid
					strokeDasharray="2 2"
					vertical={false}
					stroke="var(--border)"
				/>
				<XAxis dataKey="hour" hide />
				<Tooltip
					content={<WebhookChartTooltip formatter={(v) => `${v}`} />}
					cursor={{ fill: "var(--fig-faint)", opacity: 0.08 }}
				/>
				<Bar
					dataKey="delivered"
					name="Delivered"
					stackId="events"
					fill="var(--fig-bar)"
					radius={[1, 1, 1, 1]}
					isAnimationActive={!reducedMotion}
					animationDuration={400}
				/>
				<Bar
					dataKey="waiting"
					name="Waiting to send"
					stackId="events"
					fill="var(--fig-role-a)"
					radius={[1, 1, 1, 1]}
					isAnimationActive={!reducedMotion}
					animationDuration={400}
				/>
				<Bar
					dataKey="gaveUp"
					name="Gave up"
					stackId="events"
					fill="var(--fig-alarm)"
					radius={[1, 1, 1, 1]}
					isAnimationActive={!reducedMotion}
					animationDuration={400}
				/>
			</BarChart>
		</ResponsiveContainer>
	);
}
