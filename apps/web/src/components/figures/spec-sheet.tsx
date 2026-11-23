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
