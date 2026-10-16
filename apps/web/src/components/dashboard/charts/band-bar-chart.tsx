"use client";

import { ChartTooltip } from "@/components/charts/recharts-tooltip";
import {
	type BarsRow,
	formatAxis,
	markPillWidth,
	niceMax,
} from "@/lib/dashboard-charts";
import {
	Area,
	Bar,
	CartesianGrid,
	Cell,
	ComposedChart,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

// Adapted from Monocharts (MIT, github.com/Subhan-code/Monocharts)
// src/components/mono-charts/MonoRoundedBarChart.tsx and this repo's
// mono-area-line-chart.tsx: the recharts-driven stacked-bar geometry plus a
// ComposedChart `Area` pair for the "usual range" band, token-only colors,
// and the shared ChartTooltip. Animation stays off on every series because
// recharts' enter transition corrupts `var()` fills.

const MARK_FONT_SIZE = 10.5;

/**
 * Stacked bars per category (`n` in `--ch-a`, `p` in `--ch-b`, `f` in
 * `--alarm`; `emphasis="p"` swaps the two blues) over an optional "usual range" band. Highlighted categories fill
 * `--ch-mark`; an optional mark draws a dashed line with a pill label.
 */
export function BandBarChart({
	rows,
	height = 180,
	xLabels,
	pointLabels,
	yUnit,
	mark,
	seriesNames = { n: "Count", p: "Paid", f: "Failed" },
	emphasis = "n",
}: {
	rows: BarsRow[];
	height?: number;
	/** `[index, label]` pairs; only these categories get an x tick. */
	xLabels: [number, string][];
	/** Tooltip heading per point, such as "Thu 14:00 UTC". Falls back to the x tick. */
	pointLabels?: readonly string[];
	/** Suffix for y labels (such as "ms"). Omit for compact counts (1.2k). */
	yUnit?: string;
	/** A dashed vertical line at a category, with a `--ch-mark` pill. */
	mark?: { index: number; label: string };
	/** Tooltip names for the `n`, `p` and `f` stacks. */
	seriesNames?: { n: string; p: string; f: string };
	/** The stack drawn in the strong blue; the other gets the lighter step.
	 *  Rows sets `p` so paid usage, not the free allowance, is what stands out. */
	emphasis?: "n" | "p";
}) {
	const tone = {
		n: emphasis === "n" ? "var(--ch-a)" : "var(--ch-b)",
		p: emphasis === "p" ? "var(--ch-a)" : "var(--ch-b)",
	};
	const hasBand = rows.some((r) => r.bandLow !== null);
	const top = niceMax(
		Math.max(
			1,
			...rows.map((r) =>
				Math.max(r.n + r.p + r.f, (r.bandLow ?? 0) + (r.bandRange ?? 0)),
			),
		),
	);
	const labelAt = new Map(xLabels);
	return (
		<ResponsiveContainer width="100%" height={height}>
			<ComposedChart
				data={rows}
				margin={{ top: mark ? 22 : 8, right: 8, left: 0, bottom: 0 }}
				barCategoryGap="14%"
			>
				<CartesianGrid
					strokeDasharray="0"
					vertical={false}
					stroke="var(--line)"
				/>
				<XAxis
					dataKey="i"
					ticks={xLabels.map(([i]) => i)}
					interval={0}
					tickFormatter={(i: number) => labelAt.get(i) ?? ""}
					tick={{ fontSize: 10.5, fill: "var(--faint)" }}
					axisLine={false}
					tickLine={false}
					tickMargin={6}
				/>
				<YAxis
					ticks={[0, top / 2, top]}
					interval={0}
					domain={[0, top]}
					tickFormatter={(v: number) => formatAxis(v, yUnit)}
					tick={{ fontSize: 10.5, fill: "var(--faint)" }}
					axisLine={false}
					tickLine={false}
					width={40}
				/>
				<Tooltip
					content={<ChartTooltip />}
					labelFormatter={(i) =>
						pointLabels?.[i as number] ?? labelAt.get(i as number) ?? ""
					}
					cursor={{ fill: "var(--faint)", opacity: 0.08 }}
				/>
				{hasBand ? (
					<>
						<Area
							dataKey="bandLow"
							stackId="band"
							stroke="none"
							fill="transparent"
							isAnimationActive={false}
							legendType="none"
							tooltipType="none"
							activeDot={false}
						/>
						<Area
							dataKey="bandRange"
							stackId="band"
							stroke="none"
							fill="var(--soft)"
							fillOpacity={1}
							isAnimationActive={false}
							legendType="none"
							tooltipType="none"
							activeDot={false}
						/>
					</>
				) : null}
				<Bar
					dataKey="n"
					name={seriesNames.n}
					stackId="bars"
					fill={tone.n}
					isAnimationActive={false}
				>
					{rows.map((r) => (
						<Cell key={r.i} fill={r.highlighted ? "var(--ch-mark)" : tone.n} />
					))}
				</Bar>
				<Bar
					dataKey="p"
					name={seriesNames.p}
					stackId="bars"
					fill={tone.p}
					isAnimationActive={false}
				>
					{rows.map((r) => (
						<Cell key={r.i} fill={r.highlighted ? "var(--ch-mark)" : tone.p} />
					))}
				</Bar>
				<Bar
					dataKey="f"
					name={seriesNames.f}
					stackId="bars"
					fill="var(--alarm)"
					isAnimationActive={false}
				/>
				{mark ? (
					<ReferenceLine
						x={mark.index}
						stroke="var(--ink)"
						strokeDasharray="2 3"
						label={(props: { viewBox?: { x: number; y: number } }) => {
							const vb = props.viewBox;
							if (!vb) return <g />;
							const width = markPillWidth(mark.label, MARK_FONT_SIZE);
							return (
								<g>
									<rect
										x={vb.x + 4}
										y={vb.y - 20}
										width={width}
										height={15}
										rx={2}
										fill="var(--ch-mark)"
									/>
									<text
										x={vb.x + 9}
										y={vb.y - 9}
										fontSize={MARK_FONT_SIZE}
										fontFamily="var(--font-mono-stack)"
										fill="var(--on-mark)"
									>
										{mark.label}
									</text>
								</g>
							);
						}}
					/>
				) : null}
			</ComposedChart>
		</ResponsiveContainer>
	);
}
