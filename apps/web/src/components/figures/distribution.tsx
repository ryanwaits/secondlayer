"use client";

import { useRef } from "react";
import { useFigTooltip } from "./fig-tooltip";

const W = 640;
const H = 180;
const PL = 40;
const PR = 16;
const PT = 12;
const PB = 30;
const PW = W - PL - PR;
const PH = H - PT - PB;

/**
 * C5 Distribution — the spread, not the average. Percentile markers are
 * dashed ink (not a series color) and direct-labeled; per-bin hover
 * gives the exact count.
 */
export function Distribution({
	bins,
	binWidth,
	unit,
	percentiles,
	xTicks,
	countUnit = "samples",
	ariaLabel,
}: {
	/** Count per bin, left to right; bin i covers [i*binWidth, (i+1)*binWidth). */
	bins: number[];
	binWidth: number;
	/** Unit label for the x axis, e.g. "ms". */
	unit: string;
	/** Direct-labeled dashed markers, x in axis units. */
	percentiles?: { label: string; x: number }[];
	xTicks: number[];
	countUnit?: string;
	ariaLabel: string;
}) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const { show, hide, tooltip } = useFigTooltip(wrapRef);

	const max = Math.max(...bins);
	const bw = PW / bins.length;
	const span = bins.length * binWidth;
	const x = (v: number) => PL + (v / span) * PW;

	return (
		<div className="fig-chart-wrap" ref={wrapRef}>
			<svg
				className="fig-chart-svg"
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-label={ariaLabel}
			>
				<line
					className="grid-line"
					x1={PL}
					x2={W - PR}
					y1={PT + PH}
					y2={PT + PH}
				/>
				{bins.map((v, i) => {
					const h = (v / max) * PH;
					const lo = i * binWidth;
					return (
						<rect
							// biome-ignore lint/suspicious/noArrayIndexKey: bins are positional
							key={i}
							className="mark"
							x={PL + i * bw + 1}
							y={PT + PH - h}
							width={bw - 2}
							height={h}
							fill="var(--fig-role-a)"
							style={{ clipPath: "inset(0 round 4px 4px 0 0)" }}
							onMouseMove={(e) =>
								show(e, `${lo}–${lo + binWidth}${unit} · ${v} ${countUnit}`)
							}
							onMouseLeave={hide}
							onTouchStart={(e) =>
								show(e, `${lo}–${lo + binWidth}${unit} · ${v} ${countUnit}`)
							}
							onTouchEnd={hide}
						/>
					);
				})}
				{percentiles?.map((p) => (
					<g key={p.label}>
						<line
							className="pmark"
							x1={x(p.x)}
							x2={x(p.x)}
							y1={PT}
							y2={PT + PH}
						/>
						<text
							x={x(p.x) + 5}
							y={PT + 10}
							style={{ fill: "var(--text-muted)", fontWeight: 600 }}
						>
							{p.label}
						</text>
					</g>
				))}
				{xTicks.map((t) => (
					<text key={t} x={x(t)} y={H - 10} textAnchor="middle">
						{t}
						{unit}
					</text>
				))}
			</svg>
			{tooltip}
		</div>
	);
}
