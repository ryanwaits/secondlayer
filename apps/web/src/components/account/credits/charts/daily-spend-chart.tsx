"use client";

// Direct port of the locked mock's `drawChart()` (plans/assets/090/
// credits-usage-view.html): the mock hand-draws this chart in raw SVG
// rather than through Mono/recharts, so matching it 1:1 (hatched projected
// days, a dashed "now" line, axis labels only at day 1 / every 7th day
// before today / the last day) is most faithful as the same technique —
// plain inline SVG — instead of bending a chart library's grammar to fit.
// Colors are the app's own `--fig-*` tokens, not the mock's inline copies.

import type { DailyChartDay } from "@/lib/usage";

const WIDTH = 660;
const HEIGHT = 170;
const LEFT = 38;
const RIGHT = 8;
const TOP = 8;
const BOTTOM = 22;

/** Dollar-scale gridline step, same thresholds as the mock: coarser once
 *  the month's peak day is a few dollars, finer for a quiet account. */
function gridStep(maxDollars: number): number {
	if (maxDollars > 4) return 2;
	if (maxDollars > 1) return 0.5;
	if (maxDollars > 0.4) return 0.2;
	return 0.1;
}

function dayTotalDollars(day: DailyChartDay, rateDayDollars: number): number {
	if (day.projected) return rateDayDollars;
	return (
		(day.memUsdMicros + day.eventsUsdMicros + day.rowsUsdMicros) / 1_000_000
	);
}

export function DailySpendChart({
	days,
	rateDayUsdMicros,
	nowDay,
	showNowLine,
	monthShortLabel,
}: {
	days: DailyChartDay[];
	rateDayUsdMicros: number;
	/** 1-indexed day this month's "now" line sits after — only meaningful
	 *  when `showNowLine` is true. */
	nowDay: number;
	showNowLine: boolean;
	/** "Sep", "Oct", … — prefixes the day-of-month axis labels. */
	monthShortLabel: string;
}) {
	const rateDayDollars = rateDayUsdMicros / 1_000_000;
	const totalDays = days.length;
	const max = Math.max(
		0,
		...days.map((d) => dayTotalDollars(d, rateDayDollars)),
	);
	const step = gridStep(max);
	const top = Math.max(step, Math.ceil(max / step) * step);
	const y = (v: number) => TOP + (HEIGHT - TOP - BOTTOM) * (1 - v / top);
	const barWidth = (WIDTH - LEFT - RIGHT) / totalDays;

	const gridlines: { t: number; label: string }[] = [];
	for (let t = 0; t <= top + 1e-9; t += step) {
		gridlines.push({ t, label: `$${step < 1 ? t.toFixed(2) : t.toFixed(0)}` });
	}

	const nowX = LEFT + (nowDay - 0.5) * barWidth;

	return (
		<svg
			className="chart"
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
			role="img"
			aria-label="Daily spend, stacked by memory, events and paid rows, with projected days to the end of the month"
		>
			<defs>
				<pattern
					id="credits-chart-hatch"
					width={4}
					height={4}
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(45)"
				>
					<rect width={4} height={4} fill="transparent" />
					<line
						x1={0}
						y1={0}
						x2={0}
						y2={4}
						stroke="var(--fig-bar)"
						strokeWidth={2}
					/>
				</pattern>
			</defs>
			{gridlines.map((g) => (
				<g key={g.t}>
					<line
						x1={LEFT}
						x2={WIDTH - RIGHT}
						y1={y(g.t)}
						y2={y(g.t)}
						stroke="var(--border)"
						strokeWidth={1}
					/>
					<text x={LEFT - 6} y={y(g.t) + 3} textAnchor="end">
						{g.label}
					</text>
				</g>
			))}
			{days.map((d) => {
				const x = LEFT + (d.day - 1) * barWidth + 2;
				const w = barWidth - 4;
				const parts: Array<[string, number]> = d.projected
					? [["url(#credits-chart-hatch)", rateDayDollars]]
					: [
							["var(--fig-bar)", d.memUsdMicros / 1_000_000],
							["var(--fig-role-a)", d.eventsUsdMicros / 1_000_000],
							["var(--fig-role-b)", d.rowsUsdMicros / 1_000_000],
						];
				let base = 0;
				const rects = parts.map(([fill, value], i) => {
					if (value <= 0) return null;
					const y0 = y(base);
					const y1 = y(base + value);
					base += value;
					return (
						<rect
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed 3-part stack per bar
							key={i}
							x={x}
							y={y1}
							width={w}
							height={Math.max(0.5, y0 - y1)}
							fill={fill}
							rx={1}
							stroke={d.projected ? "var(--fig-bar)" : undefined}
							strokeWidth={d.projected ? 1 : undefined}
						/>
					);
				});
				const showLabel =
					d.day === 1 ||
					(d.day % 7 === 0 && d.day < nowDay) ||
					d.day === totalDays;
				return (
					<g key={d.date}>
						{rects}
						{showLabel ? (
							<text x={x + w / 2} y={HEIGHT - 6} textAnchor="middle">
								{monthShortLabel} {d.day}
							</text>
						) : null}
					</g>
				);
			})}
			{showNowLine ? (
				<>
					<line
						x1={nowX}
						x2={nowX}
						y1={TOP}
						y2={HEIGHT - BOTTOM}
						stroke="var(--text-main)"
						strokeWidth={1}
						strokeDasharray="2 3"
					/>
					<text x={nowX + 4} y={TOP + 9} style={{ fill: "var(--text-main)" }}>
						now
					</text>
				</>
			) : null}
		</svg>
	);
}
