import type { SparklinePoint } from "@/lib/usage";

interface Props {
	label: string;
	value: string;
	unit?: string;
	of: string;
	pct: number;
	sparkData: SparklinePoint[];
	color?: "accent" | "teal";
	/** Hide the percentage label — use when the axis has no cap (unlimited). */
	hidePct?: boolean;
}

/**
 * Build a path covering the top of a filled-area sparkline + a stroke
 * for the line on top. viewBox is 120×24, bottom-aligned.
 */
function buildSparklinePaths(data: SparklinePoint[]) {
	const n = data.length;
	if (n === 0) return { fill: "", stroke: "" };

	const max = Math.max(...data.map((d) => d.value), 1);
	const xStep = 120 / Math.max(n - 1, 1);
	const baseline = 24;

	const points = data.map((d, i) => {
		const x = i * xStep;
		const y = baseline - (d.value / max) * 22 - 1;
		return { x, y };
	});

	const stroke = points
		.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
		.join(" ");
	const fill = `${stroke} L120,24 L0,24 Z`;
	return { fill, stroke };
}

export function AxisCard({
	label,
	value,
	unit,
	of,
	pct,
	sparkData,
	color = "accent",
	hidePct = false,
}: Props) {
	const { fill, stroke } = buildSparklinePaths(sparkData);
	const pctLabel = `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`;

	return (
		<div className="axis-card">
			<div className="axis-head">
				<div className="axis-label">{label}</div>
				{!hidePct ? <div className="axis-pct">{pctLabel}</div> : null}
			</div>
			<div className="axis-value">
				{value}
				{unit ? <span className="unit">{unit}</span> : null}
			</div>
			<div className="axis-of">{of}</div>
			<div className={`axis-spark ${color}`}>
				<svg viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true">
					<title>{`${label} — 14-day trend`}</title>
					<path className="fill" d={fill} />
					<path className="stroke" d={stroke} />
				</svg>
			</div>
		</div>
	);
}
