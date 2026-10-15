/**
 * A word-scale trend line: `--ch-a` line over a faint area, an end dot, and
 * short `--alarm` ticks along the bottom at indices that had failures.
 * Geometry ported from the approved dashboard mock; plain SVG so it renders on
 * the server.
 */
export function Sparkline({
	points,
	fails = [],
	width = 132,
	height = 30,
	title,
}: {
	points: readonly number[];
	/** Failure counts per point; a tick is drawn where the count is above 0. */
	fails?: readonly number[];
	width?: number;
	height?: number;
	title: string;
}) {
	const max = Math.max(1, ...points);
	const step = width / (points.length - 1 || 1);
	const coords = points.map(
		(v, i) => [i * step, height - 2 - (v / max) * (height - 6)] as const,
	);
	const line = coords
		.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
		.join("");
	const end = coords.at(-1);
	return (
		<svg
			className="dc-svg"
			viewBox={`0 0 ${width} ${height}`}
			style={{ maxWidth: width }}
			role="img"
			aria-label={title}
		>
			{end ? (
				<>
					<path
						className="dc-area-a"
						d={`${line}L${width} ${height}L0 ${height}Z`}
					/>
					<path className="dc-stroke-a" strokeWidth={1.25} d={line} />
				</>
			) : null}
			{fails.map((f, i) =>
				f > 0 ? (
					<rect
						// biome-ignore lint/suspicious/noArrayIndexKey: ticks are positional
						key={i}
						className="dc-fill-alarm dc-tick"
						x={(i * step - 1).toFixed(1)}
						y={height - 5}
						width={2.5}
						height={5}
						rx={0.5}
					/>
				) : null,
			)}
			{end ? (
				<circle className="dc-fill-a" cx={end[0]} cy={end[1]} r={2} />
			) : null}
		</svg>
	);
}
