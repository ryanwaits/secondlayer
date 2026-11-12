import {
	type RuneRow,
	formatRuneAmount,
	runeSymbol,
} from "@/lib/protocol-stats";

const count = new Intl.NumberFormat("en-US");

/**
 * The most-minted runes, most first. A plain server-rendered table so
 * crawlers read every row; on narrow screens it scrolls sideways in its own box.
 */
export function RunesTable({ runes }: { runes: readonly RuneRow[] }) {
	return (
		<div className="live-table">
			<table>
				<thead>
					<tr>
						<th>Rune</th>
						<th>Id</th>
						<th className="num">Mints</th>
						<th className="num">Supply</th>
					</tr>
				</thead>
				<tbody>
					{runes.map((rune) => (
						<tr key={rune.id}>
							<td>
								<span className="rune-glyph" aria-hidden="true">
									{runeSymbol(rune.symbol)}
								</span>
								{rune.name}
							</td>
							<td className="mono">{rune.id}</td>
							<td className="num">{count.format(BigInt(rune.mints))}</td>
							<td className="num">
								{formatRuneAmount(rune.supply, rune.divisibility)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
