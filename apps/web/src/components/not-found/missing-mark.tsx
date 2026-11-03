/** The logo with its blue top layer missing: drawn wherever a thing we
 *  looked up isn't there. */
export function MissingMark({ size = 44 }: { size?: number }) {
	return (
		<svg
			aria-hidden="true"
			className="nf-mark"
			viewBox="6 9 36 24"
			width={size}
			height={Math.round(size * (24 / 36))}
		>
			<polygon points="8,23 28,15 40,23 20,31" className="logo-echo" />
			<polygon points="8,19 28,11 40,19 20,27" className="nf-mark-missing" />
		</svg>
	);
}
