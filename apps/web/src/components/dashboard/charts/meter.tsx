export function Meter({
	used,
	total,
	over = 0,
	left,
	right,
	label,
}: {
	used: number;
	total: number;
	over?: number;
	left?: string;
	right?: string;
	label: string;
}) {
	const percent =
		total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
	const paid = over > 0;
	return (
		<div className="dc-meter">
			<div
				className={paid ? "dc-meter-bar has-over" : "dc-meter-bar"}
				role="meter"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={paid ? total + over : total}
				aria-valuenow={paid ? total + over : Math.min(used, total)}
			>
				{paid ? (
					<>
						<div className="dc-meter-fill" style={{ flex: total }} />
						<div className="dc-meter-over" style={{ flex: over }} />
					</>
				) : (
					<div className="dc-meter-fill" style={{ width: `${percent}%` }} />
				)}
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
