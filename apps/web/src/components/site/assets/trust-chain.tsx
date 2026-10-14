const STEPS = [
	{ name: "Bitcoin header", note: "proof of work" },
	{ name: "Signer set", note: "≥70% of weight" },
	{ name: "Stacks block", note: "transaction root" },
	{ name: "State root", note: "MARF proof" },
	{ name: "Your row", note: "checked" },
] as const;

const LABEL =
	"Chain of trust: Bitcoin header, signer set, Stacks block, state root, your row. Each step is checked.";

/**
 * Bitcoin header to your row, each link checked. Renders two SVGs; CSS
 * (`.trust-wide` / `.trust-tall` in site.css) shows one per breakpoint.
 */
export function TrustChainArt() {
	return (
		<>
			<svg
				className="asset trust-wide"
				// One unit of margin each side: the first box's stroke sits on x=0
				// and would lose its outer half to the viewBox edge.
				viewBox="-1 0 822 132"
				role="img"
				aria-label={LABEL}
			>
				<g strokeWidth="1.2">
					{STEPS.map((s, i) => (
						<rect
							key={s.name}
							x={i * 171}
							y="34"
							width="136"
							height="60"
							rx="6"
							className={i === 4 ? "f-hi" : "f-paper s-ink"}
						/>
					))}
					<path
						d="M136 64h35M307 64h35M478 64h35M649 64h35"
						className="s-ink"
					/>
				</g>
				<g fontSize="12.5" textAnchor="middle">
					{STEPS.map((s, i) => (
						<text
							key={s.name}
							x={i * 171 + 68}
							y="60"
							className={i === 4 ? "f-on-hi" : "f-ink"}
						>
							{s.name}
						</text>
					))}
				</g>
				<g fontSize="11" textAnchor="middle">
					{STEPS.map((s, i) => (
						<text
							key={s.name}
							x={i * 171 + 68}
							y="79"
							className={i === 4 ? "f-on-hi" : "f-sub"}
						>
							{s.note}
						</text>
					))}
				</g>
				<g>
					{[0, 1, 2, 3].map((i) => (
						<circle key={i} cx={i * 171 + 68} cy="14" r="9" className="f-ok" />
					))}
				</g>
				<g
					strokeWidth="1.8"
					fill="none"
					className="s-paper"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M63.5 14l3 3 5.5-6M234.5 14l3 3 5.5-6M405.5 14l3 3 5.5-6M576.5 14l3 3 5.5-6" />
				</g>
				<text x="0" y="124" fontSize="11.5" className="f-sub">
					A check that passes leaves you trusting a smaller, named thing: the
					checkpoint you started from.
				</text>
			</svg>
			<svg
				className="asset trust-tall"
				viewBox="0 0 320 420"
				role="img"
				aria-label={LABEL}
			>
				<g strokeWidth="1.2">
					{STEPS.map((s, i) => (
						<rect
							key={s.name}
							x="40"
							y={i * 84}
							width="280"
							height="60"
							rx="8"
							className={i === 4 ? "f-hi" : "f-paper s-ink"}
						/>
					))}
					<path
						d="M180 60v24M180 144v24M180 228v24M180 312v24"
						className="s-ink"
					/>
				</g>
				<g fontSize="14">
					{STEPS.map((s, i) => (
						<text
							key={s.name}
							x="58"
							y={i * 84 + 27}
							className={i === 4 ? "f-on-hi" : "f-ink"}
						>
							{s.name}
						</text>
					))}
				</g>
				<g fontSize="11.5">
					{STEPS.map((s, i) => (
						<text
							key={s.name}
							x="58"
							y={i * 84 + 46}
							className={i === 4 ? "f-on-hi" : "f-sub"}
						>
							{s.note}
						</text>
					))}
				</g>
				<g>
					{[0, 1, 2, 3].map((i) => (
						<circle key={i} cx="14" cy={i * 84 + 30} r="10" className="f-ok" />
					))}
				</g>
				<g strokeWidth="2" fill="none" className="s-paper">
					<path d="M9 30l3.5 3.5 6-7M9 114l3.5 3.5 6-7M9 198l3.5 3.5 6-7M9 282l3.5 3.5 6-7" />
				</g>
			</svg>
		</>
	);
}
