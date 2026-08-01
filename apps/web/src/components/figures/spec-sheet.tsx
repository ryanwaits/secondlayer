/**
 * A10 SpecSheet — key-value facts about one thing (an endpoint, a table),
 * in the house mono data-table voice. Static by design.
 */
export function SpecSheet({
	rows,
}: {
	rows: { k: string; v: string; dim?: string }[];
}) {
	return (
		<div className="fig-sheet">
			{rows.map((row) => (
				<div className="fig-sheet-row" key={row.k}>
					<span className="fig-sheet-k">{row.k}</span>
					<span className="fig-sheet-v">
						{row.v}
						{row.dim && <span className="dim"> {row.dim}</span>}
					</span>
				</div>
			))}
		</div>
	);
}
