const PLOT_LEFT = 150;
const PLOT_RIGHT = 640;
const ROW_H = 34;
const BAR_H = 16;

/**
 * C2 BarChart — horizontal magnitude comparison. Thin marks, rounded on
 * the data end only, every bar direct-labeled (the dataviz-method
 * alternative to a hover legend). Scale runs to `domainMax` so a chart
 * can deliberately show small bars against a larger domain.
 */
export function BarChart({
	bars,
	domainMax,
	unit,
	ariaLabel,
}: {
	bars: { label: string; value: number; display?: string }[];
	/** Axis maximum; defaults to the largest value. */
	domainMax?: number;
	/** Axis note at the bottom right ("seeks to resume"). */
	unit?: string;
	ariaLabel: string;
}) {
	const max = domainMax ?? Math.max(...bars.map((b) => b.value), 1);
	const plotW = PLOT_RIGHT - PLOT_LEFT - 40;
	const height = bars.length * ROW_H + 28;

	return (
		<svg
			className="fig-cbar-svg"
			viewBox={`0 0 640 ${height}`}
			role="img"
			aria-label={ariaLabel}
		>
			<line
				className="gline"
				x1={PLOT_LEFT}
				x2={PLOT_LEFT}
				y1={8}
				y2={bars.length * ROW_H - 4}
			/>
			{bars.map((bar, i) => {
				const y = 14 + i * ROW_H;
				const w = Math.max((bar.value / max) * plotW, 2);
				return (
					<g key={bar.label}>
						<rect
							x={PLOT_LEFT}
							y={y}
							width={w}
							height={BAR_H}
							fill="var(--fig-role-a)"
							style={{ clipPath: "inset(0 round 0 4px 4px 0)" }}
						/>
						<text x={PLOT_LEFT - 10} y={y + 12} textAnchor="end">
							{bar.label}
						</text>
						<text className="dlab" x={PLOT_LEFT + w + 8} y={y + 12}>
							{bar.display ?? String(bar.value)}
						</text>
					</g>
				);
			})}
			<text x={PLOT_LEFT} y={height - 10}>
				0
			</text>
			{unit && (
				<text x={600} y={height - 10} textAnchor="end">
					{unit}
				</text>
			)}
		</svg>
	);
}
