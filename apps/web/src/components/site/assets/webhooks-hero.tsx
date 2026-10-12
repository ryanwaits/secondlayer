/** A delivery log with a 503 retried to success. Illustrative. */
export function WebhooksHero() {
	return (
		<svg
			viewBox="0 0 460 400"
			role="img"
			aria-label="Delivery log for a webhook named amm-swaps: two deliveries return 200, one returns 503 and is retried, then succeeds. Every delivery is signed with ed25519."
		>
			<rect
				x="10"
				y="20"
				width="440"
				height="330"
				rx="8"
				className="f-paper s-ink"
				strokeWidth="1"
			/>
			<text x="30" y="50" fontSize="13" className="f-ink">
				amm-swaps
			</text>
			<text x="430" y="50" fontSize="11.5" textAnchor="end" className="f-sub">
				→ my-app.com/webhook
			</text>
			<path d="M10 66h440" className="s-line" strokeWidth="1" />
			<g fontSize="10.5" className="f-sub">
				<text x="30" y="88">
					STATUS
				</text>
				<text x="92" y="88">
					LATENCY
				</text>
				<text x="168" y="88">
					TRIGGER
				</text>
				<text x="430" y="88" textAnchor="end">
					BLOCK
				</text>
			</g>
			<path d="M10 100h440" className="s-line" strokeWidth="1" />
			<g fontSize="12.5">
				<circle cx="34" cy="126" r="4" className="f-ok" />
				<text x="46" y="130" className="f-ink">
					200
				</text>
				<text x="92" y="130" className="f-ink">
					84 ms
				</text>
				<text x="168" y="130" className="f-sub">
					contract_call
				</text>
				<text x="430" y="130" textAnchor="end" className="f-sub">
					9,137,002
				</text>
				<circle cx="34" cy="164" r="4" className="f-ok" />
				<text x="46" y="168" className="f-ink">
					200
				</text>
				<text x="92" y="168" className="f-ink">
					91 ms
				</text>
				<text x="168" y="168" className="f-sub">
					ft_transfer
				</text>
				<text x="430" y="168" textAnchor="end" className="f-sub">
					9,137,004
				</text>
				<circle cx="34" cy="202" r="4" className="f-al" />
				<text x="46" y="206" className="f-al">
					503
				</text>
				<text x="92" y="206" className="f-ink">
					retrying
				</text>
				<text x="168" y="206" className="f-sub">
					contract_call
				</text>
				<text x="430" y="206" textAnchor="end" className="f-sub">
					9,137,007
				</text>
				<circle cx="34" cy="240" r="4" className="f-ok" />
				<text x="46" y="244" className="f-ink">
					200
				</text>
				<text x="92" y="244" className="f-ink">
					77 ms
				</text>
				<text x="168" y="244" className="f-sub">
					contract_call · retried
				</text>
				<text x="430" y="244" textAnchor="end" className="f-sub">
					9,137,007
				</text>
			</g>
			<path d="M18 184h4v72h-4" fill="none" className="s-sub" strokeWidth="1" />
			<path d="M10 268h440" className="s-line" strokeWidth="1" />
			<rect x="30" y="288" width="132" height="26" rx="13" className="f-hi" />
			<text
				x="96"
				y="305"
				fontSize="11.5"
				textAnchor="middle"
				className="f-on-hi"
			>
				signed · ed25519
			</text>
			<text x="10" y="374" fontSize="11" className="f-sub">
				example log
			</text>
			<text x="10" y="392" fontSize="11" className="f-sub">
				dedupe on (tx_id, event_index, block_hash)
			</text>
		</svg>
	);
}
