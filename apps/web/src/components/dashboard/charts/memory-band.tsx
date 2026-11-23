export function MemoryBand({
	points,
	capacity,
	width = 240,
	height = 30,
	title,
	stopped = false,
}: {
	points: readonly number[];
	capacity: number;
	width?: number;
	height?: number;
	title: string;
	stopped?: boolean;
}) {
	const known = capacity > 0;
	// With no known size the band can't be scaled to a ceiling. Leave headroom
	// above the peak so a steady line sits mid-height; pinned to the top it
	// would read as "full".
	const scale = known ? capacity : Math.max(...points, 0.01) * 2;
	const top = 2;
	const bottom = height - 2;
	const step = width / (points.length - 1 || 1);
	const line = points
		.map((v, i) => {
			const y = bottom - Math.min(1, Math.max(0, v / scale)) * (bottom - top);
			return `${i ? "L" : "M"}${(i * step).toFixed(1)} ${y.toFixed(1)}`;
		})
		.join("");
	return (
		<svg
			className="dc-svg"
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio="none"
			style={{ width: "100%" }}
			role="img"
			aria-label={title}
		>
			{known ? (
				<line
					className="dc-cap-line"
					x1={0}
					x2={width}
					y1={top}
					y2={top}
					vectorEffect="non-scaling-stroke"
				/>
			) : null}
			{points.length > 0 ? (
				<>
					<path
						className="dc-area-a"
						d={`${line}L${width} ${height}L0 ${height}Z`}
					/>
					<path
						className={stopped ? "dc-stroke-alarm" : "dc-stroke-a"}
						strokeWidth={1.5}
						vectorEffect="non-scaling-stroke"
						d={line}
					/>
				</>
			) : null}
		</svg>
	);
}
