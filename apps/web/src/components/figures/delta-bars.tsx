"use client";

import { useRef } from "react";
import { useFigTooltip } from "./fig-tooltip";

const W = 640;
const PL = 150;
const PR = 70;
const PT = 8;
const BW = 12;
const PAIR_GAP = 4;
const GROUP_GAP = 12;

export type DeltaGroup = {
	label: string;
	/** Role-b bar (the before/worse regime). */
	b: { value: number; tooltip: string };
	/** Role-a bar (the after/better regime); direct-labeled. */
	a: { value: number; tooltip: string; display?: string };
};

/**
 * C6 DeltaBars — before and after, paired per entity on a shared
 * baseline. The role colors carry which regime is which, consistent
 * with every other figure in the post.
 */
export function DeltaBars({
	groups,
	legend,
	max,
	ariaLabel,
}: {
	groups: DeltaGroup[];
	/** [role-b label, role-a label]. */
	legend: [string, string];
	max?: number;
	ariaLabel: string;
}) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const { show, hide, tooltip } = useFigTooltip(wrapRef);

	const domain =
		max ?? Math.max(...groups.flatMap((g) => [g.a.value, g.b.value]));
	const xs = (v: number) => Math.max(2, (v / domain) * (W - PL - PR));
	const groupH = BW * 2 + PAIR_GAP + GROUP_GAP;
	const height = PT + groups.length * groupH;

	const bar = (
		y: number,
		value: number,
		role: "a" | "b",
		tip: string,
		key: string,
	) => (
		<rect
			key={key}
			className="mark"
			x={PL}
			y={y}
			width={xs(value)}
			height={BW}
			fill={role === "a" ? "var(--fig-role-a)" : "var(--fig-role-b)"}
			style={{ clipPath: "inset(0 round 0 4px 4px 0)" }}
			onMouseMove={(e) => show(e, tip)}
			onMouseLeave={hide}
			onTouchStart={(e) => show(e, tip)}
			onTouchEnd={hide}
		/>
	);

	return (
		<div className="fig-chart-wrap" ref={wrapRef}>
			<div className="fig-legend">
				<span>
					<span className="fig-sw role-b" />
					{legend[0]}
				</span>
				<span>
					<span className="fig-sw role-a" />
					{legend[1]}
				</span>
			</div>
			<svg
				className="fig-chart-svg"
				viewBox={`0 0 ${W} ${height}`}
				role="img"
				aria-label={ariaLabel}
			>
				{groups.map((g, i) => {
					const y0 = PT + i * groupH;
					const y1 = y0 + BW + PAIR_GAP;
					return (
						<g key={g.label}>
							<text x={PL - 10} y={y0 + BW + 2} textAnchor="end">
								{g.label}
							</text>
							{bar(y0, g.b.value, "b", g.b.tooltip, `${g.label}-b`)}
							{bar(y1, g.a.value, "a", g.a.tooltip, `${g.label}-a`)}
							<text
								className="dlab"
								fill="var(--fig-role-a)"
								x={PL + xs(g.a.value) + 8}
								y={y1 + BW - 2}
							>
								{g.a.display ?? g.a.value.toLocaleString("en-US")}
							</text>
						</g>
					);
				})}
			</svg>
			{tooltip}
		</div>
	);
}
