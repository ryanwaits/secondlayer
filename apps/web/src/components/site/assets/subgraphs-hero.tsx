/** A subgraph file deploying into a table. Illustrative rows. */
export function SubgraphsHero() {
	return (
		<svg
			viewBox="0 0 460 410"
			role="img"
			aria-label="A subgraph file named sbtc-flows.ts deploys into a transfers table; the newest row, at block 9,137,007, is highlighted"
		>
			<rect
				x="20"
				y="12"
				width="300"
				height="168"
				rx="8"
				className="f-soft s-line"
				strokeWidth="1"
			/>
			<path d="M20 42h300" className="s-line" strokeWidth="1" />
			<text x="38" y="32" fontSize="12" className="f-ink">
				sbtc-flows.ts
			</text>
			<text x="302" y="32" fontSize="11" textAnchor="end" className="f-sub">
				1 file
			</text>
			<g fontSize="12">
				<text x="38" y="68" className="f-ink">
					defineSubgraph({"{"}
				</text>
				<text x="54" y="90" className="f-sub">
					sources: {"{"} transfers: ft_transfer {"}"},
				</text>
				<text x="54" y="112" className="f-sub">
					schema: {"{"} transfers: {"{"} … {"}"} {"}"},
				</text>
				<text x="54" y="134" className="f-sub">
					handlers: {"{"} transfers: insert {"}"},
				</text>
				<text x="38" y="156" className="f-ink">
					{"}"})
				</text>
			</g>

			<path d="M320 145h12" className="s-ink" strokeWidth="1" />
			<rect
				x="332"
				y="132"
				width="108"
				height="26"
				rx="13"
				className="f-paper s-ink"
				strokeWidth="1"
			/>
			<text x="386" y="149" fontSize="11" textAnchor="middle" className="f-ink">
				pin 7f3c…a91e
			</text>

			<path d="M170 180v38" className="s-ink" strokeWidth="1" />
			<path
				d="M165 212l5 7 5-7"
				fill="none"
				className="s-ink"
				strokeWidth="1"
			/>
			<text x="184" y="204" fontSize="11" className="f-sub">
				secondlayer subgraphs deploy
			</text>

			<rect
				x="20"
				y="226"
				width="420"
				height="152"
				rx="8"
				className="f-paper s-ink"
				strokeWidth="1"
			/>
			<g fontSize="11" className="f-sub">
				<text x="38" y="248">
					_block_height
				</text>
				<text x="178" y="248">
					sender
				</text>
				<text x="422" y="248" textAnchor="end">
					amount
				</text>
			</g>
			<path
				d="M20 258h420M20 288h420M20 318h420"
				className="s-line"
				strokeWidth="1"
			/>
			<g fontSize="12" className="f-ink">
				<text x="38" y="278">
					9,137,002
				</text>
				<text x="178" y="278">
					SP3PE…X44J
				</text>
				<text x="422" y="278" textAnchor="end">
					697,078,828
				</text>
				<text x="38" y="308">
					9,137,004
				</text>
				<text x="178" y="308">
					SP2J6…R4K
				</text>
				<text x="422" y="308" textAnchor="end">
					25,000,000
				</text>
			</g>
			<rect x="21" y="319" width="418" height="30" className="f-hi" />
			<g fontSize="12" className="f-on-hi">
				<text x="38" y="339">
					9,137,007
				</text>
				<text x="178" y="339">
					SP3F1…Q9A
				</text>
				<text x="422" y="339" textAnchor="end">
					250,000
				</text>
			</g>
			<text x="38" y="368" fontSize="11" className="f-sub">
				transfers · example rows
			</text>
			<text x="422" y="368" fontSize="11" textAnchor="end" className="f-sub">
				newest
			</text>
			<text x="230" y="402" fontSize="11" textAnchor="middle" className="f-sub">
				tip 9,137,007 · subgraph 9,137,007 · blocks_behind 0
			</text>
		</svg>
	);
}
