"use client";

import type { ReactNode } from "react";
// Adapted from Monocharts (MIT, github.com/Subhan-code/Monocharts)
// src/components/mono-charts/MonoRoundedBarChart.tsx — kept the rounded-bar,
// recharts-driven geometry; dropped Mono's own card chrome (header, layout
// switcher, `#181818`/neutral-* Tailwind) since the app's own `.wh-chart`/
// `.use-card` wrappers already supply that, themed with this app's own
// tokens instead. Generalized to an arbitrary N-series stack (`series`) so
// the webhooks activity chart and the credits daily-spend chart share one
// component instead of one each.
import {
	Bar,
	BarChart,
	CartesianGrid,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { ChartTooltip } from "./recharts-tooltip";

export interface StackedBarSeries {
	/** Key into each data row. */
	dataKey: string;
	/** Tooltip label for this series. */
	name: string;
	/** `var(--fig-*)` token, or `url(#pattern-id)` for a hatched fill
	 *  (the credits chart's projected days). */
	color: string;
}

export interface MonoStackedBarChartProps<
	T extends object = Record<string, unknown>,
> {
	/** Data rows are chart-specific shapes (the webhooks activity hours, the
	 *  credits daily rows, …); the chart only reads whatever keys
	 *  `series`/`xAxisDataKey` name, so any row object works — each caller's
	 *  own concrete type flows through untouched. */
	data: T[];
	series: StackedBarSeries[];
	height?: number;
	/** Category key for the x-axis (e.g. "hour", "date"). */
	xAxisDataKey?: string;
	/** Renders a visible x-axis with these tick labels; omitted entirely
	 *  (the webhooks activity chart) when not given. */
	xAxisTickFormatter?: (value: string | number, index: number) => string;
	/** Only these category values get a tick — the credits chart's "day 1,
	 *  every 7th before today, the last day" rule. Omit to let recharts
	 *  pick automatically. */
	xAxisTicks?: Array<string | number>;
	/** Renders a visible, left-aligned y-axis with these ticks — omitted
	 *  entirely (the webhooks activity chart) when not given. */
	yAxisTicks?: number[];
	yAxisTickFormatter?: (value: number) => string;
	/** A dashed vertical marker at one category value (the credits chart's
	 *  "now" line). */
	referenceLineX?: { value: string | number; label: string };
	/** SVG `<pattern>` definitions rendered in `<defs>` — callers own their
	 *  own pattern shape (the credits chart's projected-day hatch). */
	patternDefs?: ReactNode;
	tooltipFormatter?: (value: number | string, name: string) => ReactNode;
	tooltipLabelFormatter?: (label: string | number) => string;
}

/** One stacked bar per category, one `<Bar>` per series, animation off: this
 *  chart can re-render on every poll, and recharts would otherwise replay
 *  the entrance animation on every refresh — and, briefly, corrupt a
 *  low-opacity `var()` fill (recharts interpolates `fill` frame-by-frame for
 *  the enter transition, which doesn't understand `var()`). */
export function MonoStackedBarChart<T extends object>({
	data,
	series,
	height = 120,
	xAxisDataKey,
	xAxisTickFormatter,
	xAxisTicks,
	yAxisTicks,
	yAxisTickFormatter,
	referenceLineX,
	patternDefs,
	tooltipFormatter,
	tooltipLabelFormatter,
}: MonoStackedBarChartProps<T>) {
	const showXAxis = Boolean(xAxisTickFormatter);
	const showYAxis = Boolean(yAxisTicks);
	return (
		<ResponsiveContainer width="100%" height={height}>
			<BarChart
				data={data}
				margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
				barCategoryGap={1}
			>
				{patternDefs ? <defs>{patternDefs}</defs> : null}
				<CartesianGrid
					strokeDasharray="2 2"
					vertical={false}
					stroke="var(--border)"
				/>
				<XAxis
					dataKey={xAxisDataKey}
					hide={!showXAxis}
					ticks={xAxisTicks}
					tickFormatter={xAxisTickFormatter}
					tick={{ fontSize: 10, fill: "var(--fig-faint)" }}
					axisLine={false}
					tickLine={false}
					interval={0}
				/>
				{showYAxis ? (
					<YAxis
						ticks={yAxisTicks}
						interval={0}
						domain={[0, "dataMax"]}
						tickFormatter={yAxisTickFormatter}
						tick={{ fontSize: 10, fill: "var(--fig-faint)" }}
						axisLine={false}
						tickLine={false}
						width={38}
					/>
				) : null}
				<Tooltip
					content={<ChartTooltip formatter={tooltipFormatter} />}
					labelFormatter={
						tooltipLabelFormatter
							? (label) => tooltipLabelFormatter(label as string | number)
							: undefined
					}
					cursor={{ fill: "var(--fig-faint)", opacity: 0.08 }}
				/>
				{series.map((s) => (
					<Bar
						key={s.dataKey}
						dataKey={s.dataKey}
						name={s.name}
						stackId="stack"
						fill={s.color}
						radius={[1, 1, 1, 1]}
						isAnimationActive={false}
					/>
				))}
				{referenceLineX ? (
					<ReferenceLine
						x={referenceLineX.value}
						stroke="var(--text-main)"
						strokeDasharray="2 3"
						label={{
							value: referenceLineX.label,
							position: "insideTopRight",
							fill: "var(--text-main)",
							fontSize: 10,
						}}
					/>
				) : null}
			</BarChart>
		</ResponsiveContainer>
	);
}
