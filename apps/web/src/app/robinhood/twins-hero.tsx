import { STACKS_SYMBOL_PATH } from "./stacks-symbol";

/**
 * The round trip as flat art: the locked SIP-010 and its ERC-20 twin, linked
 * 1:1. Illustrative amounts. Robin Neon appears once, on the twin's "live"
 * chip, next to the official feather avatar (black on Robin Neon, unmodified).
 */
export function TwinsHero() {
	return (
		<svg
			viewBox="0 0 460 384"
			role="img"
			aria-label="Two token cards: 1,000 of a SIP-010 token locked on Stacks, and its twin, 1,000 of an ERC-20 live on chain 4663, linked one to one"
		>
			<defs>
				<clipPath id="rh-coin">
					<circle cx="62" cy="304" r="20" />
				</clipPath>
			</defs>
			<g strokeWidth="1">
				<rect
					x="20"
					y="20"
					width="420"
					height="104"
					rx="8"
					className="f-paper s-ink"
				/>
				<circle cx="62" cy="72" r="20" className="f-soft s-line" />
				<rect
					x="354"
					y="78"
					width="62"
					height="20"
					rx="10"
					className="f-paper s-ink"
				/>
				<path d="M62 124v128" className="s-ink" />
				<path d="m56 238 6 10 6-10" fill="none" className="s-ink" />
				<rect
					x="20"
					y="252"
					width="420"
					height="104"
					rx="8"
					className="f-paper s-ink"
				/>
			</g>
			<g transform="translate(53 63) scale(0.22)" className="f-ink">
				<path fillRule="evenodd" d={STACKS_SYMBOL_PATH} />
			</g>
			<image
				href="/robinhood-chain/feather.jpg"
				x="42"
				y="284"
				width="40"
				height="40"
				clipPath="url(#rh-coin)"
				preserveAspectRatio="xMidYMid slice"
			/>
			<rect x="368" y="310" width="48" height="20" rx="10" className="f-neon" />

			<g fontSize="16" fontWeight="500" className="f-ink t-sans">
				<text x="98" y="68">
					SIP-010
				</text>
				<text x="98" y="300">
					ERC-20
				</text>
			</g>
			<g fontSize="18" fontWeight="500" textAnchor="end" className="f-ink">
				<text x="416" y="68">
					1,000
				</text>
				<text x="416" y="300">
					1,000
				</text>
			</g>
			<g fontSize="12" className="f-sub">
				<text x="98" y="90">
					Stacks · locker
				</text>
				<text x="98" y="192">
					mints after 6 BTC confirmations
				</text>
				<text x="98" y="212">
					burn the twin to release
				</text>
				<text x="98" y="322">
					chain 4663 · twin
				</text>
			</g>
			<g fontSize="11" textAnchor="middle">
				<text x="385" y="92" className="f-ink">
					locked
				</text>
				<text x="392" y="324" className="f-on-neon">
					live
				</text>
				<text x="230" y="378" className="f-sub">
					supply on 4663 = balance held by the locker
				</text>
			</g>
			<text x="98" y="170" fontSize="15" fontWeight="500" className="f-ink">
				1 : 1
			</text>
		</svg>
	);
}
