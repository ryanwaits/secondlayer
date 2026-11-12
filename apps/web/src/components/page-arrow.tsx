/** The chevron inside a pager's back/next buttons. */
export function PageArrow({ back }: { back?: boolean }) {
	return (
		<svg
			width="6"
			height="10"
			viewBox="0 0 6 10"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d={back ? "M5 1L1 5l4 4" : "M1 1l4 4-4 4"} />
		</svg>
	);
}
