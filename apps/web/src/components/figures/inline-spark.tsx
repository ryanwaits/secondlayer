const W = 64;
const H = 14;
const PAD = 2;

/**
 * C7 InlineSpark — a word-scale sparkline inside a sentence. No axes, an
 * endpoint dot, and a required title (also the aria-label) describing the
 * trend for readers who can't see it.
 */
export function InlineSpark({
	points,
	tone = "a",
	title,
}: {
	points: number[];
	tone?: "a" | "b";
	title: string;
}) {
	const min = Math.min(...points);
	const max = Math.max(...points);
	const range = max - min || 1;
	const coords = points.map((p, i) => {
		const x = PAD + (i / (points.length - 1)) * (W - PAD * 2);
		const y = H - PAD - ((p - min) / range) * (H - PAD * 2);
		return [x, y] as const;
	});
	const last = coords[coords.length - 1];

	return (
		<svg
			className="fig-spark"
			width={W}
			height={H}
			viewBox={`0 0 ${W} ${H}`}
			role="img"
			aria-label={title}
		>
			<title>{title}</title>
			<polyline
				className={`role-${tone}`}
				points={coords.map(([x, y]) => `${x},${y}`).join(" ")}
				fill="none"
				strokeWidth={1.5}
			/>
			<circle className={`role-${tone}`} cx={last[0]} cy={last[1]} r={2} />
		</svg>
	);
}
