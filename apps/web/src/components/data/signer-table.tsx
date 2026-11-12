import type { SignerRow } from "@/lib/protocol-stats";

const stx = new Intl.NumberFormat("en-US");

/**
 * Signers of the current cycle, largest delegation first. A plain server
 * rendered table so crawlers read every row; it scrolls inside its own box on
 * narrow screens.
 */
export function SignerTable({ signers }: { signers: readonly SignerRow[] }) {
	return (
		<div className="live-table">
			<table>
				<thead>
					<tr>
						<th>Signer</th>
						<th className="num">Stacked STX</th>
						<th className="num">Share</th>
						<th>In set</th>
					</tr>
				</thead>
				<tbody>
					{signers.map((row) => (
						<tr key={row.principal}>
							<td title={row.principal}>{row.name}</td>
							<td className="num">{stx.format(row.stackedStx)}</td>
							<td className="num">{row.sharePct.toFixed(1)}%</td>
							<td>{row.inSet ? "Yes" : "No"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
