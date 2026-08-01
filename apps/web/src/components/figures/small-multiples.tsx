const PW = 180;
const PH = 90;
const PT = 34;
const GAP = 28;

/**
 * C3 SmallMultiples — the same measure across many entities. Shared
 * scales always (a per-panel scale is a lie); one measure, mono panel
 * titles, endpoint dots instead of a legend.
 */
export function SmallMultiples({
	panels,
	yMax,
	ariaLabel,
}: {
	panels: { title: string; points: number[]; tone?: "role-a" | "alarm" }[];
	yMax: number;
	ariaLabel: string;
}) {
	const width = 16 + panels.length * (PW + GAP);

	return (
		<svg
			className="fig-chart-svg"
			viewBox={`0 0 ${width} ${PT + PH + 26}`}
			role="img"
			aria-label={ariaLabel}
		>
			{panels.map((panel, p) => {
				const x0 = 16 + p * (PW + GAP);
				const color =
					panel.tone === "alarm" ? "var(--fig-alarm)" : "var(--fig-role-a)";
				const pt = (v: number, i: number) => {
					const px = x0 + (i / (panel.points.length - 1)) * PW;
					const py = PT + PH - (Math.max(0, Math.min(yMax, v)) / yMax) * PH;
					return [px, py] as const;
				};
				const last = pt(
					panel.points[panel.points.length - 1],
					panel.points.length - 1,
				);
				return (
					<g key={panel.title}>
						<text
							x={x0}
							y={PT - 14}
							style={{ fontWeight: 600, fill: "var(--text-muted)" }}
						>
							{panel.title}
						</text>
						<line
							className="grid-line"
							x1={x0}
							x2={x0 + PW}
							y1={PT + PH}
							y2={PT + PH}
						/>
						<path
							d={panel.points
								.map((v, i) => {
									const [px, py] = pt(v, i);
									return `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`;
								})
								.join(" ")}
							fill="none"
							stroke={color}
							strokeWidth={2}
						/>
						<circle cx={last[0]} cy={last[1]} r={3} fill={color} />
					</g>
				);
			})}
		</svg>
	);
}
