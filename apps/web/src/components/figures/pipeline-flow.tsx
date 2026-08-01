const STAGE_H = 46;
const STAGE_Y = 26;
const EDGE_W = 40;
const PAD = 12;

/**
 * B5 PipelineFlow — multi-stage system, flowing left to right. Adopts
 * the service-flow node grammar: Chrome default, tinted "data" stage,
 * exactly ONE filled-accent "api" node for the product surface. Edge
 * dashes march via CSS (still under reduced-motion).
 */
export function PipelineFlow({
	stages,
	ariaLabel,
}: {
	stages: {
		label: string;
		sub?: string;
		kind?: "default" | "data" | "api";
		w?: number;
	}[];
	ariaLabel: string;
}) {
	let x = PAD;
	const placed = stages.map((s, i) => {
		const w = s.w ?? 120;
		const node = { ...s, x, w };
		x += w + (i < stages.length - 1 ? EDGE_W : 0);
		return node;
	});
	const width = x + PAD;

	return (
		<svg
			className="fig-pipe-svg"
			viewBox={`0 0 ${width} 96`}
			role="img"
			aria-label={ariaLabel}
		>
			{placed.map((s, i) => (
				<g key={s.label}>
					{i > 0 && (
						<path
							className="pedge flow"
							d={`M${s.x - EDGE_W} ${STAGE_Y + STAGE_H / 2} H ${s.x}`}
						/>
					)}
					<g
						className={`pnode${s.kind && s.kind !== "default" ? ` ${s.kind}` : ""}`}
					>
						<rect x={s.x} y={STAGE_Y} width={s.w} height={STAGE_H} rx={6} />
						<text x={s.x + s.w / 2} y={STAGE_Y + 20} textAnchor="middle">
							{s.label}
						</text>
						{s.sub && (
							<text
								className="sub"
								x={s.x + s.w / 2}
								y={STAGE_Y + 35}
								textAnchor="middle"
							>
								{s.sub}
							</text>
						)}
					</g>
				</g>
			))}
		</svg>
	);
}
