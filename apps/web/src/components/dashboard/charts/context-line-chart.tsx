"use client";

import { ChartTooltip } from "@/components/charts/recharts-tooltip";
import { formatAxis, niceMax } from "@/lib/dashboard-charts";
import {
	CartesianGrid,
	ComposedChart,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

// Adapted from Monocharts (MIT, github.com/Subhan-code/Monocharts) via this
// repo's mono-area-line-chart.tsx: a recharts ComposedChart with token-only
// colors, the shared ChartTooltip, and animation off.

/**
 * Two lines on one scale: a dashed `context` series (what we expected, such as
 * "Matched on chain" or "Our timeout") and the measured `--ch-a` series.
 */
export function ContextLineChart({
	context,
	values,
	contextName,
	valueName,
	height = 130,
	xLabels,
	yUnit,
}: {
	context: readonly number[];
	values: readonly number[];
	contextName: string;
	valueName: string;
	height?: number;
	/** `[index, label]` pairs; only these points get an x tick. */
	xLabels: [number, string][];
	/** Suffix for y labels (such as "s"). Omit for compact counts (1.2k). */
	yUnit?: string;
}) {
	const rows = values.map((value, i) => ({
		i,
		context: context[i] ?? null,
		value,
	}));
	const top = niceMax(Math.max(0.01, ...context, ...values));
	const labelAt = new Map(xLabels);
	return (
		<ResponsiveContainer width="100%" height={height}>
			<ComposedChart
				data={rows}
				margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
			>
				<CartesianGrid
					strokeDasharray="0"
					vertical={false}
					stroke="var(--line)"
				/>
				<XAxis
					type="number"
					dataKey="i"
					domain={[0, Math.max(1, values.length - 1)]}
					ticks={xLabels.map(([i]) => i)}
					interval={0}
					tickFormatter={(i: number) => labelAt.get(i) ?? ""}
					tick={{ fontSize: 10.5, fill: "var(--faint)" }}
					axisLine={false}
					tickLine={false}
					tickMargin={6}
				/>
				<YAxis
					ticks={[0, top]}
					interval={0}
					domain={[0, top]}
					tickFormatter={(v: number) => formatAxis(v, yUnit)}
					tick={{ fontSize: 10.5, fill: "var(--faint)" }}
					axisLine={false}
					tickLine={false}
					width={36}
				/>
				<Tooltip
					content={<ChartTooltip />}
					labelFormatter={(i) => labelAt.get(i as number) ?? ""}
					cursor={{ stroke: "var(--faint)", strokeWidth: 1 }}
				/>
				<Line
					dataKey="context"
					name={contextName}
					stroke="var(--sub)"
					strokeWidth={1.25}
					strokeDasharray="3 3"
					dot={false}
					activeDot={false}
					isAnimationActive={false}
				/>
				<Line
					dataKey="value"
					name={valueName}
					stroke="var(--ch-a)"
					strokeWidth={1.5}
					dot={false}
					isAnimationActive={false}
				/>
			</ComposedChart>
		</ResponsiveContainer>
	);
}
