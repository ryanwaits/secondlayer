export type StripPointer = {
	label: string;
	sub?: string;
	role: "a" | "b";
	/** Position on the strip, 0–100. */
	pos: number;
};

/**
 * Density strip + labeled pointers, the visual core of the D1 explorer.
 * Merge rule: when two pointers come within `mergeThreshold` percent they
 * collapse into one merged pointer (gradient stem, `mergedLabel`) at the
 * rightmost position. Pure render — state lives in the composing explorer.
 */
export function PointerStrip({
	cells,
	pointers,
	mergedLabel,
	mergeThreshold = 10,
}: {
	/** Hit flag per cell, left to right. */
	cells: boolean[];
	pointers: StripPointer[];
	mergedLabel?: string;
	mergeThreshold?: number;
}) {
	const sorted = [...pointers].sort((a, b) => a.pos - b.pos);
	const merged =
		sorted.length === 2 &&
		mergedLabel !== undefined &&
		sorted[1].pos - sorted[0].pos < mergeThreshold;

	return (
		<div>
			<div className="fig-strip" aria-hidden="true">
				{cells.map((hit, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: cells are positional by definition
						key={i}
						className={hit ? "fig-cell hit" : "fig-cell"}
					/>
				))}
			</div>
			<div className="fig-ptrs">
				{sorted.map((p) => (
					<div
						key={p.label}
						className={`fig-ptr role-${p.role}`}
						style={{
							left: `${merged ? sorted[1].pos : p.pos}%`,
							opacity: merged ? 0 : 1,
						}}
					>
						<span className="stem" />
						<span className="plabel">{p.label}</span>
						{p.sub && <span>{p.sub}</span>}
					</div>
				))}
				{mergedLabel && (
					<div
						className="fig-ptr merged"
						style={{
							left: `${sorted.length ? sorted[sorted.length - 1].pos : 50}%`,
							opacity: merged ? 1 : 0,
						}}
					>
						<span className="stem" />
						<span className="plabel">{mergedLabel}</span>
					</div>
				)}
			</div>
		</div>
	);
}
