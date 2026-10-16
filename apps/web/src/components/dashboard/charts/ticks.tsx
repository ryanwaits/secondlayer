/**
 * Delivery ticks: one thin bar per hour that had deliveries, `--alarm` where
 * any failed. Deliveries are discrete events, so a tick marks presence, never
 * magnitude: every bar is the same height. Plain SVG so it renders on the
 * server.
 */
export function Ticks({
	delivered,
	failed = [],
	width = 132,
	height = 30,
	title,
}: {
	/** Deliveries per hour. */
	delivered: readonly number[];
	/** Failed deliveries per hour, same length as `delivered`. */
	failed?: readonly number[];
	width?: number;
	height?: number;
	title: string;
}) {
	const slot = width / (delivered.length || 1);
	return (
		<svg
			className="dc-svg"
			viewBox={`0 0 ${width} ${height}`}
			style={{ maxWidth: width }}
			role="img"
			aria-label={title}
		>
			<line
				className="dc-tick-base"
				x1={0}
				x2={width}
				y1={height - 0.5}
				y2={height - 0.5}
			/>
			{delivered.map((n, i) => {
				const hasFailure = (failed[i] ?? 0) > 0;
				if (!hasFailure && n <= 0) return null;
				return (
					<rect
						// biome-ignore lint/suspicious/noArrayIndexKey: ticks are positional
						key={i}
						className={hasFailure ? "dc-fill-alarm" : "dc-fill-a"}
						x={(i * slot + slot / 2 - 1).toFixed(1)}
						y={4}
						width={2}
						height={height - 4}
						rx={1}
					/>
				);
			})}
		</svg>
	);
}
