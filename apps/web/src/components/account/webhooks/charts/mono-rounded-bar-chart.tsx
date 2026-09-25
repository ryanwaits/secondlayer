"use client";

// Adapted from Monocharts (MIT, github.com/Subhan-code/Monocharts)
// src/components/mono-charts/MonoRoundedBarChart.tsx — kept the rounded-bar,
// recharts-driven geometry; dropped Mono's own card chrome (header, layout
// switcher, `#181818`/neutral-* Tailwind) since `.wh-chart` already supplies
// that, themed with this app's own tokens instead. Each bar is colored per
// delivery outcome (a `<Cell>` per point) rather than Mono's two fixed series.

import { useEffect, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ResponsiveContainer,
	Tooltip,
	YAxis,
} from "recharts";
import { WebhookChartTooltip } from "./recharts-tooltip";

export interface AttemptBar {
	label: string;
	durationMs: number;
	ok: boolean;
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

/** Bar height = response time (capped at `maxMs`); 2xx blue, error/timeout
 *  red. `data` is oldest → latest, left to right. */
export function MonoRoundedBarChart({
	data,
	maxMs = 2000,
	height = 160,
}: {
	data: AttemptBar[];
	maxMs?: number;
	height?: number;
}) {
	const reducedMotion = usePrefersReducedMotion();

	return (
		<ResponsiveContainer width="100%" height={height}>
			<BarChart
				data={data}
				margin={{ top: 8, right: 4, left: -22, bottom: 0 }}
				barCategoryGap={1}
			>
				<CartesianGrid
					strokeDasharray="2 2"
					vertical={false}
					stroke="var(--border)"
				/>
				<YAxis
					domain={[0, maxMs]}
					ticks={[0, maxMs / 2, maxMs]}
					tickLine={false}
					axisLine={false}
					width={40}
					tick={{ fontSize: 10, fill: "var(--ink-demoted)" }}
					tickFormatter={(v: number) =>
						v === 0 ? "0" : v >= maxMs ? "2s+" : `${v / 1000}s`
					}
				/>
				<Tooltip
					content={<WebhookChartTooltip formatter={(v) => `${v} ms`} />}
					cursor={{ fill: "var(--fig-faint)", opacity: 0.08 }}
				/>
				<Bar
					dataKey="durationMs"
					name="Response time"
					radius={[2, 2, 2, 2]}
					minPointSize={2}
					isAnimationActive={!reducedMotion}
					animationDuration={400}
				>
					{data.map((d, i) => (
						<Cell
							// Bars are positional (oldest → latest); nothing else identifies one.
							// biome-ignore lint/suspicious/noArrayIndexKey: positional, not an identity
							key={i}
							fill={d.ok ? "var(--fig-role-a)" : "var(--fig-alarm)"}
						/>
					))}
				</Bar>
			</BarChart>
		</ResponsiveContainer>
	);
}
