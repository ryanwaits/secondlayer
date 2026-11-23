const RAMP = [
	"var(--bg-chrome)",
	"color-mix(in srgb, var(--fig-role-a) 22%, var(--bg-elevated))",
	"color-mix(in srgb, var(--fig-role-a) 52%, var(--bg-elevated))",
	"var(--fig-role-a)",
];

export function HeatCalendar({
	weeks,
	unit = "events",
	legend = true,
	ariaLabel,
}: {
	weeks: number[][];
	unit?: string;
	legend?: boolean;
	ariaLabel: string;
}) {
	return (
		<div>
			<div className="fig-heat-scroll">
				<div className="fig-heat" role="img" aria-label={ariaLabel}>
					{weeks.map((week, w) =>
						week.map((level, d) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: grid cells are positional
								key={`${w}-${d}`}
								className="fig-hcell"
								style={{ background: RAMP[Math.max(0, Math.min(3, level))] }}
								title={`week ${w + 1}, day ${d + 1}: ${level} ${unit}`}
							/>
						)),
					)}
				</div>
			</div>
			{legend && (
				<div className="fig-heat-legend">
					<span>none</span>
					{RAMP.map((bg) => (
						<span key={bg} className="fig-hcell" style={{ background: bg }} />
					))}
					<span>many</span>
				</div>
			)}
		</div>
	);
}
