/** Bars of seconds between recent blocks. The newest bar is `--ch-a`, the rest `--ch-b`. */
export function Cadence({
	intervals,
	width = 300,
	height = 44,
}: {
	/** Seconds between consecutive blocks, oldest first. */
	intervals: readonly number[];
	width?: number;
	height?: number;
}) {
	const max = Math.max(1, ...intervals);
	const bw = width / (intervals.length || 1);
	return (
		<svg
			className="dc-svg"
			viewBox={`0 0 ${width} ${height}`}
			style={{ maxWidth: width }}
			role="img"
			aria-label={`Seconds between the last ${intervals.length} blocks`}
		>
			{intervals.map((s, i) => {
				const h = Math.max(2, (s / max) * (height - 4));
				const last = i === intervals.length - 1;
				return (
					<rect
						// biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
						key={i}
						className={last ? "dc-fill-a" : "dc-fill-b"}
						x={(i * bw + 1).toFixed(1)}
						y={(height - h).toFixed(1)}
						width={Math.max(1, bw - 2).toFixed(1)}
						height={h.toFixed(1)}
						rx={1}
					>
						<title>{`${s}s`}</title>
					</rect>
				);
			})}
		</svg>
	);
}
