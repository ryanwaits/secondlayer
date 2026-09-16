/* "Powered by secondlayer" lockup. The mark is the current secondlayer
   logo (apps/web/src/components/logo.tsx): isometric layer in ink with a
   24% echo underneath, wordmark at weight 500. Ink follows the theme via
   currentColor, so there is no second hue on the site. */
export function SecondlayerMark({ size = 17 }: { size?: number }) {
	return (
		<svg
			aria-hidden="true"
			className="sl-mark"
			fill="none"
			height={Math.round(size * (24 / 36))}
			viewBox="6 9 36 24"
			width={size}
		>
			<polygon points="8,23 28,15 40,23 20,31" opacity="0.24" />
			<polygon points="8,19 28,11 40,19 20,27" />
		</svg>
	);
}

export function PoweredBy({ label = "Powered by" }: { label?: string }) {
	return (
		<a
			className="sl-powered"
			href="https://secondlayer.tools"
			rel="noreferrer"
			target="_blank"
		>
			<span className="sl-powered-label">{label}</span>
			<SecondlayerMark />
			<span className="sl-powered-name">secondlayer</span>
		</a>
	);
}
