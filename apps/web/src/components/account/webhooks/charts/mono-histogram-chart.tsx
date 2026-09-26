"use client";

// Adapted from Monocharts (MIT, github.com/Subhan-code/Monocharts)
// src/components/mono-charts/MonoRoundedBarChart.tsx — same rounded-bar,
// recharts-driven geometry as the other webhook charts, with three
// `ReferenceLine`s (median, half the timeout, timeout) instead of Mono's own
// annotations.

import type { HistogramBin } from "@/lib/webhook-graphs";
import {
	Bar,
	BarChart,
	CartesianGrid,
	ReferenceLine,
	ResponsiveContainer,
	XAxis,
} from "recharts";

/** A response-time distribution: 20 bins from 0 to the webhook's timeout,
 *  with median (`--fig-role-a`), half the timeout (dashed `--fig-faint`) and
 *  the timeout itself (`--fig-alarm`) marked. */
export function MonoHistogramChart({
	bins,
	median,
	timeoutMs,
	height = 100,
}: {
	bins: HistogramBin[];
	median: number;
	timeoutMs: number;
	height?: number;
}) {
	const data = bins.map((bin) => ({
		x: (bin.rangeStart + bin.rangeEnd) / 2,
		count: bin.count,
	}));

	return (
		<ResponsiveContainer width="100%" height={height}>
			<BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
				<CartesianGrid
					strokeDasharray="2 2"
					vertical={false}
					stroke="var(--border)"
				/>
				<XAxis dataKey="x" type="number" domain={[0, timeoutMs]} hide />
				<Bar
					dataKey="count"
					fill="var(--fig-bar)"
					radius={[1, 1, 1, 1]}
					barSize={16}
					isAnimationActive={false}
				/>
				<ReferenceLine
					x={timeoutMs / 2}
					stroke="var(--fig-faint)"
					strokeDasharray="3 3"
				/>
				<ReferenceLine
					x={median}
					stroke="var(--fig-role-a)"
					strokeWidth={1.5}
				/>
				<ReferenceLine
					x={timeoutMs}
					stroke="var(--fig-alarm)"
					strokeWidth={1.5}
				/>
			</BarChart>
		</ResponsiveContainer>
	);
}
