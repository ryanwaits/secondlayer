/** A subgraph file becomes a table; the newest row is highlighted. Illustrative rows. */
export function SubgraphTableArt() {
	return (
		<svg
			className="asset"
			viewBox="0 0 400 180"
			role="img"
			aria-label="A subgraph file on the left becomes a table on the right, with the newest row highlighted."
		>
			<rect
				x="0"
				y="10"
				width="150"
				height="150"
				rx="6"
				className="f-paper s-line"
				strokeWidth="1"
			/>
			<g fontSize="10">
				<text x="12" y="32" className="f-sub">
					transfers.ts
				</text>
				<path d="M0 42h150" className="s-line" strokeWidth="1" />
				<text x="12" y="64" className="f-ink">
					defineSubgraph({"{"}
				</text>
				<text x="22" y="84" className="f-sub">
					sources: [sbtc],
				</text>
				<text x="22" y="104" className="f-sub">
					schema: {"{ … }"},
				</text>
				<text x="22" y="124" className="f-sub">
					handlers: {"{ … }"},
				</text>
				<text x="12" y="144" className="f-ink">
					{"})"}
				</text>
			</g>
			<path d="M160 85h30" className="s-ink" strokeWidth="1.2" />
			<path
				d="M185 80l6 5-6 5"
				fill="none"
				className="s-ink"
				strokeWidth="1.2"
			/>
			<rect
				x="200"
				y="10"
				width="200"
				height="150"
				rx="6"
				className="f-paper s-line"
				strokeWidth="1"
			/>
			<g className="s-line" strokeWidth="1">
				<path d="M200 40h200M200 70h200M200 100h200M200 130h200" />
			</g>
			<g fontSize="9.5" className="f-sub">
				<text x="210" y="29">
					height
				</text>
				<text x="270" y="29">
					sender
				</text>
				<text x="390" y="29" textAnchor="end">
					amount
				</text>
			</g>
			<g fontSize="10" className="f-ink">
				<text x="210" y="59">
					9137002
				</text>
				<text x="270" y="59">
					SP2J…4K
				</text>
				<text x="390" y="59" textAnchor="end">
					0.42
				</text>
				<text x="210" y="89">
					9137003
				</text>
				<text x="270" y="89">
					SP3F…9A
				</text>
				<text x="390" y="89" textAnchor="end">
					1.10
				</text>
				<text x="210" y="119">
					9137005
				</text>
				<text x="270" y="119">
					SP1R…7D
				</text>
				<text x="390" y="119" textAnchor="end">
					0.08
				</text>
			</g>
			<rect x="201" y="131" width="198" height="28" className="f-hi" />
			<g fontSize="10" className="f-on-hi">
				<text x="210" y="149">
					9137006
				</text>
				<text x="270" y="149">
					SP1Q…2C
				</text>
				<text x="390" y="149" textAnchor="end">
					0.05
				</text>
			</g>
			<text x="0" y="178" fontSize="9.5" className="f-sub">
				illustrative rows
			</text>
		</svg>
	);
}
