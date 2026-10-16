/**
 * A strip of day cells, oldest first: filled where the day had any activity,
 * a short faint mark where it had none. Answers "is this in use?" at a glance
 * without implying a quantity. Plain SVG so it renders on the server.
 */
export function DayStrip({
	days,
	width = 240,
	height = 14,
	title,
}: {
	/** Activity per day, oldest first; a cell is filled when above 0. */
	days: readonly number[];
	width?: number;
	height?: number;
	title: string;
}) {
	const gap = 2;
	const cell =
		(width - gap * Math.max(0, days.length - 1)) / (days.length || 1);
	return (
		<svg
			className="dc-svg"
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio="none"
			style={{ width: "100%" }}
			role="img"
			aria-label={title}
		>
			{days.map((n, i) => {
				const active = n > 0;
				return (
					<rect
						// biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
						key={i}
						className={active ? "dc-fill-a" : "dc-day-empty"}
						x={(i * (cell + gap)).toFixed(1)}
						y={active ? 0 : (height - 4) / 2}
						width={cell.toFixed(1)}
						height={active ? height : 4}
						rx={1}
					/>
				);
			})}
		</svg>
	);
}
