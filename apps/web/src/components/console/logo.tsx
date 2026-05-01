export function Logo({ size = 20 }: { size?: number }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="6 9 36 24"
			width={size}
			height={Math.round(size * (24 / 36))}
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<polygon points="8,23 28,15 40,23 20,31" className="logo-echo" />
			<polygon points="8,19 28,11 40,19 20,27" className="logo-primary" />
		</svg>
	);
}
