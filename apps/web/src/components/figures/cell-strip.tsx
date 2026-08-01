/**
 * C4 CellStrip — density/occupancy along an axis (matching blocks, gaps).
 * 2px surface gaps between cells; hits in the role color, never a new hue.
 */
export function CellStrip({
	cells,
	hits,
	ariaLabel,
}: {
	cells: number;
	/** Indices of filled cells. */
	hits: number[];
	ariaLabel: string;
}) {
	const hitSet = new Set(hits);
	return (
		<div className="fig-strip" role="img" aria-label={ariaLabel}>
			{Array.from({ length: cells }, (_, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: cells are positional by definition
					key={i}
					className={hitSet.has(i) ? "fig-cell hit" : "fig-cell"}
				/>
			))}
		</div>
	);
}
