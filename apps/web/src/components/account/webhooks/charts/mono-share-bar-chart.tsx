"use client";

// Adapted from Monocharts (MIT, github.com/Subhan-code/Monocharts)
// src/components/mono-charts/MonoRoundedBarChart.tsx — same rounded-bar,
// recharts-driven geometry as the other webhook charts. Each bar is colored
// by whether it crosses the rule's 50% threshold (a `<Cell>` per point),
// with a dashed `ReferenceLine` marking that threshold.

import type { HourlyRateLimitShare } from "@/lib/webhook-graphs";
import {
	Bar,
	BarChart,
	Cell,
	ReferenceLine,
	ResponsiveContainer,
	YAxis,
} from "recharts";

const RATE_LIMITED_THRESHOLD_PCT = 50;

/** Share of attempts answered 429, one bar per hour, oldest → newest. Bars at
 *  or above the rule's threshold are `--yellow`; the rest are `--fig-bar`. */
export function MonoShareBarChart({
	hours,
	height = 90,
}: {
	hours: HourlyRateLimitShare[];
	height?: number;
}) {
	return (
		<ResponsiveContainer width="100%" height={height}>
			<BarChart
				data={hours}
				margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
				barCategoryGap={1}
			>
				<YAxis domain={[0, 100]} hide />
				<Bar dataKey="sharePct" radius={[1, 1, 1, 1]} isAnimationActive={false}>
					{hours.map((h) => (
						<Cell
							key={h.hour}
							fill={
								h.sharePct >= RATE_LIMITED_THRESHOLD_PCT
									? "var(--yellow)"
									: "var(--fig-bar)"
							}
						/>
					))}
				</Bar>
				<ReferenceLine
					y={RATE_LIMITED_THRESHOLD_PCT}
					stroke="var(--fig-faint)"
					strokeDasharray="3 3"
				/>
			</BarChart>
		</ResponsiveContainer>
	);
}
