/** Three decoded event cards leading to a cursor. Illustrative values. */
export function IndexHero() {
	return (
		<svg
			viewBox="0 0 460 370"
			role="img"
			aria-label="Three decoded events stacked as cards, the front one an ft_transfer at block 8,948,506, leading to a next_cursor of 8948506:12"
		>
			<g strokeWidth="1">
				<rect
					x="72"
					y="14"
					width="360"
					height="190"
					rx="8"
					className="f-paper s-line"
				/>
				<rect
					x="46"
					y="48"
					width="360"
					height="190"
					rx="8"
					className="f-paper s-line"
				/>
				<rect
					x="20"
					y="82"
					width="360"
					height="206"
					rx="8"
					className="f-paper s-ink"
				/>
			</g>
			<g fontSize="12">
				<text x="92" y="37" className="f-sub">
					contract_call
				</text>
				<text x="412" y="37" textAnchor="end" className="f-sub">
					event 10
				</text>
				<text x="66" y="71" className="f-sub">
					nft_mint
				</text>
				<text x="386" y="71" textAnchor="end" className="f-sub">
					event 11
				</text>
			</g>
			<text x="40" y="112" fontSize="14" className="f-ink">
				ft_transfer
			</text>
			<rect x="290" y="97" width="72" height="22" rx="4" className="f-hi" />
			<text
				x="326"
				y="112"
				fontSize="12"
				textAnchor="middle"
				className="f-on-hi"
			>
				event 12
			</text>
			<path d="M20 128h360" className="s-line" strokeWidth="1" />
			<g fontSize="12">
				<text x="40" y="156" className="f-sub">
					block_height
				</text>
				<text x="360" y="156" textAnchor="end" className="f-ink">
					8,948,506
				</text>
				<text x="40" y="182" className="f-sub">
					contract
				</text>
				<text x="360" y="182" textAnchor="end" className="f-ink">
					SM3V…sbtc-token
				</text>
				<text x="40" y="208" className="f-sub">
					sender
				</text>
				<text x="360" y="208" textAnchor="end" className="f-ink">
					SP2J…R4K
				</text>
				<text x="40" y="234" className="f-sub">
					recipient
				</text>
				<text x="360" y="234" textAnchor="end" className="f-ink">
					SP3F…Q9A
				</text>
				<text x="40" y="260" className="f-sub">
					amount
				</text>
				<text x="360" y="260" textAnchor="end" className="f-ink">
					25,000,000
				</text>
			</g>
			<path d="M200 288v40" className="s-ink" strokeWidth="1" />
			<rect x="88" y="328" width="224" height="30" rx="15" className="f-pri" />
			<text
				x="200"
				y="348"
				fontSize="12.5"
				textAnchor="middle"
				className="f-on-pri"
			>
				next_cursor 8948506:12
			</text>
		</svg>
	);
}
