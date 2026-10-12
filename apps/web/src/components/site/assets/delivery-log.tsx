/** A webhook delivery log: successes, one 503 with a retry. Illustrative. */
export function DeliveryLogArt() {
	return (
		<svg
			className="asset"
			viewBox="0 0 400 180"
			role="img"
			aria-label="A delivery log: three successful deliveries, one 503 with a retry, then success."
		>
			<g fontSize="9.5" className="f-sub">
				<text x="0" y="16">
					status
				</text>
				<text x="80" y="16">
					latency
				</text>
				<text x="190" y="16">
					event
				</text>
			</g>
			<path d="M0 26h400" className="s-line" strokeWidth="1" />
			<g fontSize="11">
				<circle cx="5" cy="46" r="4" className="f-ok" />
				<text x="18" y="50" className="f-ink">
					200
				</text>
				<text x="80" y="50" className="f-ink">
					84 ms
				</text>
				<text x="190" y="50" className="f-sub">
					ft_transfer
				</text>
				<circle cx="5" cy="74" r="4" className="f-ok" />
				<text x="18" y="78" className="f-ink">
					200
				</text>
				<text x="80" y="78" className="f-ink">
					91 ms
				</text>
				<text x="190" y="78" className="f-sub">
					nft_mint
				</text>
				<circle cx="5" cy="102" r="4" className="f-al" />
				<text x="18" y="106" className="f-al">
					503
				</text>
				<text x="80" y="106" className="f-ink">
					retry in 30 s
				</text>
				<text x="190" y="106" className="f-sub">
					ft_transfer
				</text>
				<circle cx="5" cy="130" r="4" className="f-ok" />
				<text x="18" y="134" className="f-ink">
					200
				</text>
				<text x="80" y="134" className="f-ink">
					77 ms
				</text>
				<text x="190" y="134" className="f-sub">
					ft_transfer · retried
				</text>
			</g>
			<path d="M0 148h400" className="s-line" strokeWidth="1" />
			<text x="0" y="172" fontSize="9.5" className="f-sub">
				retries free · logged · requeueable
			</text>
			<rect x="290" y="157" width="110" height="22" rx="11" className="f-hi" />
			<text
				x="345"
				y="172"
				fontSize="9.5"
				textAnchor="middle"
				className="f-on-hi"
			>
				signed · ed25519
			</text>
		</svg>
	);
}
