const TOP = 26;
const ROW0 = 48;
const ROW_H = 37;
const W = 620;

/**
 * B6 SequenceDiagram — 3+ parties exchanging messages where order
 * matters. Hover or focus a message: it and both endpoints light (pure
 * CSS :hover/:focus-visible — no JS, so this stays a server component).
 * Returns are dashed. Keep to ≤6 messages; past that it's two diagrams.
 */
export function SequenceDiagram({
	actors,
	messages,
	ariaLabel,
}: {
	actors: string[];
	messages: { from: number; to: number; label: string; ret?: boolean }[];
	ariaLabel: string;
}) {
	const xs = actors.map(
		(_, i) => 80 + (i * (W - 160)) / Math.max(actors.length - 1, 1),
	);
	const height = ROW0 + messages.length * ROW_H - 3;

	return (
		<svg
			className="fig-seq-svg"
			viewBox={`0 0 ${W} ${height + 10}`}
			role="img"
			aria-label={ariaLabel}
		>
			{actors.map((a, i) => (
				<g key={a}>
					<text className="actor" x={xs[i]} y={16} textAnchor="middle">
						{a}
					</text>
					<line
						className="lifeline"
						x1={xs[i]}
						y1={TOP}
						x2={xs[i]}
						y2={height}
					/>
				</g>
			))}
			{messages.map((m, i) => {
				const y = ROW0 + i * ROW_H;
				return (
					<g key={m.label} className={m.ret ? "msg ret" : "msg"} tabIndex={0}>
						<line x1={xs[m.from]} y1={y} x2={xs[m.to]} y2={y} />
						<circle cx={xs[m.from]} cy={y} r={3.5} />
						<circle cx={xs[m.to]} cy={y} r={3.5} />
						<text x={(xs[m.from] + xs[m.to]) / 2} y={y - 7} textAnchor="middle">
							{m.label}
						</text>
					</g>
				);
			})}
		</svg>
	);
}
