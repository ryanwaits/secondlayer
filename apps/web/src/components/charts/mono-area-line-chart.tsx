"use client";

import type { ReactNode } from "react";
// New Mono-styled chart (github.com/Subhan-code/Monocharts, MIT,
// github.com/Subhan-code/Monocharts) — follows the same recharts-driven,
// token-only-colored pattern as mono-stacked-bar-chart.tsx and
// mono-lag-line-chart.tsx: a continuous value line, an area fill that only
// covers the stretches where the underlying sample is real (not a
// floor-only fallback), a dashed threshold reference line, and an endpoint
// dot. Built for the credits page's hosted-stack memory chart.
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	ReferenceDot,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { ChartTooltip } from "./recharts-tooltip";

export interface AreaLinePoint {
	x: number;
	/** The connected line's value — a real sample, or a floor fallback. */
	value: number;
	/** The real (not-fallen-back) sample, or `null`. The area fill only
	 *  covers stretches where this is non-null (`connectNulls={false}`
	 *  breaks the fill, never the line, at a `null`). */
	areaValue: number | null;
	/** Extra flat fields a caller wants surfaced as their own tooltip row
	 *  (e.g. the billed floor alongside the actual sample). */
	[key: string]: number | null | undefined;
}

export function MonoAreaLineChart({
	data,
	height = 144,
	xDomain,
	xTicks,
	xTickFormatter,
	yTicks,
	yTickFormatter,
	referenceLineY,
	showEndpointDot = false,
	valueName,
	extraSeries,
	tooltipFormatter,
}: {
	data: AreaLinePoint[];
	height?: number;
	xDomain: [number, number];
	xTicks: number[];
	xTickFormatter: (value: number) => string;
	yTicks: number[];
	yTickFormatter: (value: number) => string;
	/** A dashed horizontal marker (the credits chart's 0.5 GB minimum). */
	referenceLineY?: { value: number; label: string };
	showEndpointDot?: boolean;
	valueName: string;
	/** Extra flat fields to surface as their own tooltip row, invisible on
	 *  the chart itself (e.g. `{ dataKey: "billedGb", name: "Billed" }`). */
	extraSeries?: Array<{ dataKey: string; name: string }>;
	tooltipFormatter?: (value: number | string, name: string) => ReactNode;
}) {
	const last = data.at(-1) ?? null;
	return (
		<ResponsiveContainer width="100%" height={height}>
			<ComposedChart
				data={data}
				margin={{ top: 8, right: 8, left: 0, bottom: 16 }}
			>
				<CartesianGrid
					strokeDasharray="2 2"
					vertical={false}
					stroke="var(--border)"
				/>
				<XAxis
					type="number"
					dataKey="x"
					domain={xDomain}
					ticks={xTicks}
					interval={0}
					tickFormatter={xTickFormatter}
					tick={{ fontSize: 10, fill: "var(--fig-faint)" }}
					axisLine={false}
					tickLine={false}
					tickMargin={8}
					height={24}
				/>
				<YAxis
					ticks={yTicks}
					interval={0}
					domain={[0, yTicks[yTicks.length - 1]]}
					tickFormatter={yTickFormatter}
					tick={{ fontSize: 10, fill: "var(--fig-faint)" }}
					axisLine={false}
					tickLine={false}
					width={44}
				/>
				<Tooltip
					content={<ChartTooltip formatter={tooltipFormatter} />}
					labelFormatter={() => ""}
					cursor={{ stroke: "var(--fig-faint)", strokeWidth: 1 }}
				/>
				<Area
					dataKey="areaValue"
					stroke="none"
					fill="color-mix(in srgb, var(--fig-role-a) 12%, transparent)"
					connectNulls={false}
					isAnimationActive={false}
					legendType="none"
					tooltipType="none"
				/>
				{extraSeries?.map((s) => (
					<Line
						key={s.dataKey}
						dataKey={s.dataKey}
						name={s.name}
						stroke="transparent"
						strokeWidth={0}
						dot={false}
						activeDot={false}
						isAnimationActive={false}
					/>
				))}
				<Line
					dataKey="value"
					name={valueName}
					stroke="var(--fig-role-a)"
					strokeWidth={1.5}
					dot={false}
					isAnimationActive={false}
				/>
				{referenceLineY ? (
					<ReferenceLine
						y={referenceLineY.value}
						stroke="var(--text-main)"
						strokeDasharray="4 3"
						label={(props: {
							viewBox?: { x: number; y: number; width: number };
						}) => {
							const viewBox = props.viewBox;
							if (!viewBox) return undefined;
							return (
								<text
									x={viewBox.x + viewBox.width}
									y={viewBox.y - 6}
									textAnchor="end"
									fill="var(--text-main)"
									fontSize={10}
								>
									{referenceLineY.label}
								</text>
							);
						}}
					/>
				) : null}
				{showEndpointDot && last ? (
					<ReferenceDot
						x={last.x}
						y={last.value}
						r={3}
						fill="var(--fig-role-a)"
						stroke="none"
					/>
				) : null}
			</ComposedChart>
		</ResponsiveContainer>
	);
}
