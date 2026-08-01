"use client";

import { useRef, useState } from "react";
import { useFigTooltip } from "./fig-tooltip";

const W = 640;
const H = 240;
const PL = 52;
const PR = 16;
const PT = 14;
const PB = 32;
const PW = W - PL - PR;
const PH = H - PT - PB;
const MIN_GAP = 14;

export type LineSeries = {
	id: string;
	role: "a" | "b";
	label: string;
	points: { x: number; y: number }[];
};

/**
 * C1 LineChart — change over time, ≤4 series. Direct end labels with
 * vertical collision resolution (nudged ≥14px apart, clamped inside the
 * plot, pushed off the threshold label's band); crosshair + tooltip
 * clamped to both container edges; touch drags the crosshair.
 */
export function LineChart({
	series,
	yMax,
	xTicks,
	yTicks,
	threshold,
	ariaLabel,
}: {
	series: LineSeries[];
	yMax: number;
	xTicks: { v: number; label: string }[];
	yTicks: { v: number; label: string }[];
	threshold?: { y: number; label: string };
	ariaLabel: string;
}) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const { show, hide, tooltip } = useFigTooltip(wrapRef);
	const [crossX, setCrossX] = useState<number | null>(null);

	// Cheap enough to recompute per render (a handful of series, ~40 points).
	const xs = series.flatMap((s) => s.points.map((p) => p.x));
	const xDomain = [Math.min(...xs), Math.max(...xs)] as const;

	const x = (v: number) =>
		PL + ((v - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * PW;
	const y = (v: number) => PT + PH - (v / yMax) * PH;

	// End labels: nudge pairs ≥MIN_GAP apart, clamp inside the plot, and
	// push off the threshold label's band (which places first).
	const threshY = threshold ? y(threshold.y) - 6 : null;
	const clampY = (v: number) => Math.max(PT + 10, Math.min(PT + PH - 4, v));
	let endLabels = series.map((s) =>
		clampY(y(s.points[s.points.length - 1].y) - 8),
	);
	for (let pass = 0; pass < 3; pass++) {
		endLabels = endLabels.map((yi, i) => {
			let v = yi;
			endLabels.forEach((yj, j) => {
				if (j !== i && Math.abs(v - yj) < MIN_GAP) {
					v = v > yj ? yj + MIN_GAP : yj - MIN_GAP;
				}
			});
			if (threshY !== null && Math.abs(v - threshY) < MIN_GAP) {
				v = threshY - MIN_GAP;
			}
			return clampY(v);
		});
	}

	const move = (clientX: number) => {
		const svg = svgRef.current;
		if (!svg) return;
		const r = svg.getBoundingClientRect();
		const px = ((clientX - r.left) / r.width) * W;
		if (px < PL || px > W - PR) {
			leave();
			return;
		}
		const xv = xDomain[0] + ((px - PL) / PW) * (xDomain[1] - xDomain[0]);
		// nearest sample of the first series drives the crosshair for all
		const pts = series[0].points;
		let best = 0;
		pts.forEach((p, i) => {
			if (Math.abs(p.x - xv) < Math.abs(pts[best].x - xv)) best = i;
		});
		setCrossX(pts[best].x);
		show(
			{ clientX },
			<>
				{formatX(pts[best].x, xTicks)}
				{series.map((s) => (
					<div key={s.id}>
						<span className={`tt-${s.role}`}>{s.label}</span>{" "}
						{s.points[best]?.y.toLocaleString("en-US")}
					</div>
				))}
			</>,
			20,
		);
	};

	const leave = () => {
		setCrossX(null);
		hide();
	};

	return (
		<div className="fig-chart-wrap" ref={wrapRef}>
			<div className="fig-legend">
				{series.map((s) => (
					<span key={s.id}>
						<span className={`fig-sw role-${s.role}`} />
						{s.label}
					</span>
				))}
			</div>
			<svg
				ref={svgRef}
				className="fig-chart-svg"
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-label={ariaLabel}
				onMouseMove={(e) => move(e.clientX)}
				onMouseLeave={leave}
				onTouchStart={(e) => move(e.touches[0].clientX)}
				onTouchMove={(e) => move(e.touches[0].clientX)}
				onTouchEnd={leave}
			>
				{yTicks.map((t) => (
					<g key={t.v}>
						<line
							className="grid-line"
							x1={PL}
							x2={W - PR}
							y1={y(t.v)}
							y2={y(t.v)}
						/>
						<text x={PL - 8} y={y(t.v) + 3.5} textAnchor="end">
							{t.label}
						</text>
					</g>
				))}
				{xTicks.map((t) => (
					<text key={t.v} x={x(t.v)} y={H - 10} textAnchor="middle">
						{t.label}
					</text>
				))}
				{threshold && (
					<>
						<line
							className="thresh"
							x1={PL}
							x2={W - PR}
							y1={y(threshold.y)}
							y2={y(threshold.y)}
						/>
						<text
							className="t-lab"
							x={W - PR}
							y={y(threshold.y) - 6}
							textAnchor="end"
						>
							{threshold.label}
						</text>
					</>
				)}
				{series.map((s) => (
					<path
						key={s.id}
						className={`s-${s.role}`}
						d={s.points
							.map(
								(p, i) =>
									`${i ? "L" : "M"}${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`,
							)
							.join(" ")}
					/>
				))}
				{series.map((s, i) => (
					<text
						key={s.id}
						className={`dl dl-${s.role}`}
						x={W - PR - 4}
						y={endLabels[i]}
						textAnchor="end"
					>
						{s.label}
					</text>
				))}
				{crossX !== null && (
					<line
						className="xh"
						x1={x(crossX)}
						x2={x(crossX)}
						y1={PT}
						y2={PT + PH}
					/>
				)}
			</svg>
			{tooltip}
		</div>
	);
}

function formatX(v: number, ticks: { v: number; label: string }[]): string {
	const exact = ticks.find((t) => t.v === v);
	if (exact) return exact.label;
	// time-style ticks ("9:00") interpolate to h:mm; else show the number
	if (ticks[0]?.label.includes(":")) {
		const hh = Math.floor(v);
		const mm = String(Math.round((v - hh) * 60)).padStart(2, "0");
		return `${hh}:${mm}`;
	}
	return v.toLocaleString("en-US");
}
