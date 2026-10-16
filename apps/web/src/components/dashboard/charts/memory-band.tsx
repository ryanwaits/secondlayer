/**
 * Memory against its ceiling: a `--ch-a` line over a faint area, scaled to the
 * stack's size and drawn under a dashed size line. Turns `--alarm` when the
 * stack is stopped. Plain SVG so it renders on the server.
 */
export function MemoryBand({
	points,
	capacity,
	width = 240,
	height = 30,
	title,
	stopped = false,
}: {
	/** Memory in GB per hour. */
	points: readonly number[];
	/** Stack size in GB; the y scale tops out here. */
	capacity: number;
	width?: number;
	height?: number;
	title: string;
	stopped?: boolean;
}) {
	const known = capacity > 0;
	const scale = known ? capacity : Math.max(...points, 0.01);
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
