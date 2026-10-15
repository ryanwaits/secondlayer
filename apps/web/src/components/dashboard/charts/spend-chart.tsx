"use client";

import { ChartTooltip } from "@/components/charts/recharts-tooltip";
import {
	formatUsdTick,
	niceMax,
	spendProjection,
} from "@/lib/dashboard-charts";
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	ReferenceDot,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

// Adapted from Monocharts (MIT, github.com/Subhan-code/Monocharts) via this
// repo's mono-area-line-chart.tsx: area plus line plus endpoint dot, token-only
// colors, the shared ChartTooltip, animation off.

const usd = (n: number) =>
	`$${Math.abs(n) < 0.01 && n !== 0 ? n.toFixed(4) : n.toFixed(2)}`;

/**
 * Cumulative spend this month: a `--ch-a` line over a faint area, a dashed
 * projection to month end at the mean of the last 7 days, today's value above
 * the end dot and the projected total to its right.
 */
export function SpendChart({
	daily,
	daysInMonth,
	monthLabel,
	height = 150,
}: {
	/** Cost per day so far, day 1 first. */
	daily: readonly number[];
	daysInMonth: number;
	/** Short month name for the first tick, such as "Oct". */
	monthLabel: string;
	height?: number;
}) {
	const { cumulative, spent, projectedEnd } = spendProjection(
		daily,
		daysInMonth,
	);
	const today = cumulative.length - 1;
	const rows = Array.from({ length: daysInMonth }, (_, i) => ({
		day: i,
		cumulative: i <= today ? (cumulative[i] ?? null) : null,
		projection:
			i === today ? spent : i === daysInMonth - 1 ? projectedEnd : null,
	}));
	const top = niceMax(projectedEnd * 1.05);
	const ticks = [0, Math.floor((daysInMonth - 1) / 2), daysInMonth - 1];
	const tickLabel = (i: number) =>
		i === 0 ? `${monthLabel} 1` : String(i + 1);
	return (
		<ResponsiveContainer width="100%" height={height}>
			<ComposedChart
				data={rows}
				margin={{ top: 18, right: 52, left: 0, bottom: 0 }}
			>
				<CartesianGrid
					strokeDasharray="0"
					vertical={false}
					stroke="var(--line)"
				/>
				<XAxis
					type="number"
					dataKey="day"
					domain={[0, daysInMonth - 1]}
					ticks={ticks}
					interval={0}
					tickFormatter={tickLabel}
					tick={{ fontSize: 10.5, fill: "var(--faint)" }}
					axisLine={false}
					tickLine={false}
					tickMargin={6}
				/>
				<YAxis
					ticks={[0, top / 2, top]}
					interval={0}
					domain={[0, top]}
					tickFormatter={(v: number) => formatUsdTick(v)}
					tick={{ fontSize: 10.5, fill: "var(--faint)" }}
					axisLine={false}
					tickLine={false}
					width={40}
				/>
				<Tooltip
					content={<ChartTooltip formatter={(v) => usd(Number(v))} />}
					labelFormatter={(d) => `${monthLabel} ${Number(d) + 1}`}
					cursor={{ stroke: "var(--faint)", strokeWidth: 1 }}
				/>
				<Area
					dataKey="cumulative"
					stroke="none"
					fill="var(--ch-a)"
					fillOpacity={0.09}
					isAnimationActive={false}
					legendType="none"
					tooltipType="none"
					activeDot={false}
				/>
				<Line
					dataKey="cumulative"
					name="Spent"
					stroke="var(--ch-a)"
					strokeWidth={1.5}
					dot={false}
					isAnimationActive={false}
				/>
				<Line
					dataKey="projection"
					name="Projected"
					stroke="var(--sub)"
					strokeDasharray="3 3"
					strokeWidth={1.25}
					dot={false}
					activeDot={false}
					connectNulls
					isAnimationActive={false}
				/>
				<ReferenceDot
					x={today}
					y={spent}
					r={2.5}
					fill="var(--ch-a)"
					stroke="none"
					label={{
						value: usd(spent),
						position: "top",
						fill: "var(--ink)",
						fontSize: 10.5,
					}}
				/>
				<ReferenceDot
					x={daysInMonth - 1}
					y={projectedEnd}
					r={0}
					fill="none"
					stroke="none"
					label={{
						value: usd(projectedEnd),
						position: "right",
						fill: "var(--faint)",
						fontSize: 10.5,
					}}
				/>
			</ComposedChart>
		</ResponsiveContainer>
	);
}
