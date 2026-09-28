"use client";

// Direct port of the locked mock's `drawMem()` (plans/assets/090/
// credits-usage-view.html) — see daily-spend-chart.tsx for why this is
// plain inline SVG rather than Mono/recharts. Unlike the mock's synthetic
// sine-wave demo data, this plots the real hourly `memory24h` samples.

import { MEMORY_FLOOR_GB, type MemoryHourRow } from "@/lib/usage";

const WIDTH = 660;
const HEIGHT = 120;
const LEFT = 38;
const RIGHT = 8;
const TOP = 10;
const BOTTOM = 20;
const FLOOR_GB = MEMORY_FLOOR_GB;

type Point = {
	x: number;
	y: number;
	/** `true` when this hour has a real `observedGb` sample — an area-fill
	 *  segment only spans between two `hasObserved` points either side. */
	hasObserved: boolean;
};

export function MemoryChart({
	memory24h,
	now,
}: { memory24h: MemoryHourRow[]; now: Date }) {
	const maxGb = Math.max(
		FLOOR_GB,
		...memory24h.map((r) => r.observedGb ?? r.billedGb),
	);
	const top = Math.max(
		1,
		Math.ceil(Math.max(maxGb * 1.3, FLOOR_GB * 1.3) * 4) / 4,
	);
	const y = (v: number) => TOP + (HEIGHT - TOP - BOTTOM) * (1 - v / top);
	const x = (hoursFrom24hAgo: number) =>
		LEFT + (WIDTH - LEFT - RIGHT) * (hoursFrom24hAgo / 24);

	const points: Point[] = memory24h.map((row) => {
		const hoursAgo = (now.getTime() - new Date(row.hour).getTime()) / 3_600_000;
		const hoursFrom24hAgo = Math.min(24, Math.max(0, 24 - hoursAgo));
		const value = row.observedGb ?? row.billedGb;
		return {
			x: x(hoursFrom24hAgo),
			y: y(value),
			hasObserved: row.observedGb != null,
		};
	});

	const linePath = points
		.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
		.join(" ");

	// One fill polygon per contiguous run of `hasObserved` points, each
	// closed down to the y(0) baseline.
	const fillPaths: string[] = [];
	let run: Point[] = [];
	const flushRun = () => {
		if (run.length >= 2) {
			const baseline = y(0);
			const top2 = run
				.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
				.join(" L");
			fillPaths.push(
				`M${top2} L${run[run.length - 1]?.x.toFixed(1)} ${baseline} L${run[0]?.x.toFixed(1)} ${baseline} Z`,
			);
		}
		run = [];
	};
	for (const p of points) {
		if (p.hasObserved) run.push(p);
		else flushRun();
	}
	flushRun();

	const latest = memory24h.at(-1) ?? null;
	const currentGb = latest ? (latest.observedGb ?? latest.billedGb) : 0;
	const endPoint = points.at(-1) ?? null;

	const gridTicks = [0, top / 2, top];

	return (
		<svg
			className="use-chart"
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
			role="img"
			aria-label="Memory used over the last 24 hours against the 0.5 GB billing minimum"
		>
			{gridTicks.map((t) => (
				<g key={t}>
					<line
						x1={LEFT}
						x2={WIDTH - RIGHT}
						y1={y(t)}
						y2={y(t)}
						stroke="var(--border)"
						strokeWidth={1}
					/>
					<text x={LEFT - 6} y={y(t) + 3} textAnchor="end">
						{t.toFixed(2).replace(/0$/, "")} GB
					</text>
				</g>
			))}
			{fillPaths.map((d) => (
				<path
					key={d}
					d={d}
					fill="color-mix(in srgb, var(--fig-role-a) 12%, transparent)"
				/>
			))}
			{points.length > 0 ? (
				<path
					d={linePath}
					fill="none"
					stroke="var(--fig-role-a)"
					strokeWidth={1.5}
				/>
			) : null}
			<line
				x1={LEFT}
				x2={WIDTH - RIGHT}
				y1={y(FLOOR_GB)}
				y2={y(FLOOR_GB)}
				stroke="var(--text-main)"
				strokeWidth={1}
				strokeDasharray="4 3"
			/>
			<text
				x={WIDTH - RIGHT}
				y={y(FLOOR_GB) - 5}
				textAnchor="end"
				style={{ fill: "var(--text-main)" }}
			>
				{currentGb < FLOOR_GB ? "0.5 GB minimum (billed)" : "0.5 GB minimum"}
			</text>
			{endPoint ? (
				<circle
					cx={endPoint.x}
					cy={endPoint.y}
					r={3}
					fill="var(--fig-role-a)"
				/>
			) : null}
			<text x={x(0)} y={HEIGHT - 5} textAnchor="start">
				24h ago
			</text>
			<text x={x(12)} y={HEIGHT - 5} textAnchor="middle">
				12h
			</text>
			<text x={x(24)} y={HEIGHT - 5} textAnchor="end">
				now
			</text>
		</svg>
	);
}
