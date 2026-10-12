export interface ManifestRow {
	dataset: string;
	rows: string;
	/** 0-100, rendered as an ink bar. */
	share: number;
	coverage: string;
}

/** Signed-manifest table: yellow seal, dataset rows with ink share bars. */
export function Manifest({
	title,
	rows,
}: {
	title: string;
	rows: readonly ManifestRow[];
}) {
	return (
		<div className="mani">
			<div className="mani-head">
				<span className="seal">
					<i />
					signed
				</span>
				<span className="t">{title}</span>
			</div>
			<div className="tblwrap">
				<table>
					<thead>
						<tr>
							<th>Dataset</th>
							<th className="num">Rows</th>
							<th>Share of the set</th>
							<th>Coverage</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.dataset}>
								<td>{row.dataset}</td>
								<td className="num">{row.rows}</td>
								<td>
									<div className="bar">
										{row.share}%
										<span>
											<i style={{ width: `${row.share}%` }} />
										</span>
									</div>
								</td>
								<td className="mono">{row.coverage}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
