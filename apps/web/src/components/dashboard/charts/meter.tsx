/** A 6px track with a `--ch-a` fill and a caption on each side. */
export function Meter({
	used,
	total,
	left,
	right,
	label,
}: {
	used: number;
	total: number;
	left?: string;
	right?: string;
	/** Accessible name for the bar. */
	label: string;
}) {
	const percent =
		total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
	return (
		<div className="dc-meter">
			<div
				className="dc-meter-bar"
				role="meter"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={total}
				aria-valuenow={Math.min(used, total)}
			>
				<div className="dc-meter-fill" style={{ width: `${percent}%` }} />
			</div>
			{left || right ? (
				<div className="dc-meter-captions">
					<span>{left}</span>
					<span>{right}</span>
				</div>
			) : null}
		</div>
	);
}
