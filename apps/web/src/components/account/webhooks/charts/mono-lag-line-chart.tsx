"use client";

// Adapted from Monocharts (MIT, github.com/Subhan-code/Monocharts)
// src/components/mono-charts/MonoRoundedBarChart.tsx — swapped the bar
// geometry for a line (`recharts` `Line`), keeping the same card chrome and
// token-only coloring as the other webhook charts.

import type { LagPoint } from "@/lib/webhook-graphs";
import {
	CartesianGrid,
	Line,
	LineChart,
	ReferenceLine,
	ResponsiveContainer,
} from "recharts";

const LAG_THRESHOLD_MS = 60_000;

/** Seconds between a block and its delivery, newest 40 events, oldest →
 *  newest. A dashed line marks 60s, the `delivery_lag` rule's threshold. */
export function MonoLagLineChart({
	points,
	height = 80,
}: {
	points: LagPoint[];
	height?: number;
}) {
	const data = points.map((p) => ({
		dispatchedAt: p.dispatchedAt,
		lagMs: p.lagMs,
	}));

	return (
		<ResponsiveContainer width="100%" height={height}>
			<LineChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
				<CartesianGrid
					strokeDasharray="2 2"
					vertical={false}
					stroke="var(--border)"
				/>
				<ReferenceLine
					y={LAG_THRESHOLD_MS}
					stroke="var(--fig-faint)"
					strokeDasharray="3 3"
				/>
				<Line
					type="monotone"
					dataKey="lagMs"
					stroke="var(--fig-role-a)"
					strokeWidth={1.5}
					dot={false}
					isAnimationActive={false}
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}
