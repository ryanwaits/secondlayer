const LINKS = [
	{ name: "Bitcoin headers", note: "proof of work" },
	{ name: "Signer set", note: "≥ 70% of weight signed" },
	{ name: "Stacks block", note: "tx merkle root" },
	{ name: "State root", note: "witness + MARF" },
] as const;

const LABEL =
	"Chain of trust: a trusted checkpoint, then Bitcoin headers, signer set, Stacks block, state root and your row, each checked";
const LABEL_TALL =
	"Chain of trust, vertical: checkpoint, Bitcoin headers, signer set, Stacks block, state root, your row";

/** x of the Nth box in the wide layout (checkpoint is box 0). */
const WIDE_X = [0.5, 188.5, 362.5, 536.5, 710.5] as const;

/**
 * The Verify page's chain: a dashed, trusted-as-is checkpoint first, then four
 * checked links ending on the yellow row. Two SVGs; `.chain-wide` /
 * `.chain-tall` in site.css show one per breakpoint.
 */
export function VerifyChainArt() {
	return (
		<>
			<svg
				className="asset chain-wide"
				viewBox="0 0 1072 190"
				role="img"
				aria-label={LABEL}
			>
				<g strokeWidth="1" fill="none">
					<rect
						x="0.5"
						y="56.5"
						width="132"
						height="64"
						rx="8"
						className="f-paper s-sub"
						strokeDasharray="4 3"
					/>
					{LINKS.map((l, i) => (
						<rect
							key={l.name}
							x={WIDE_X[i + 1]}
							y="56.5"
							width="148"
							height="64"
							rx="8"
							className="f-paper s-ink"
						/>
					))}
					<rect
						x="884"
						y="56"
						width="188"
						height="65"
						rx="8"
						className="f-hi"
					/>
					<path
						d="M133 88.5h55M337 88.5h25M511 88.5h25M685 88.5h25M859 88.5h25"
						className="s-ink"
					/>
				</g>
				<g fontSize="13" textAnchor="middle">
					<text x="66" y="84" className="f-sub">
						Checkpoint
					</text>
					{LINKS.map((l, i) => (
						<text key={l.name} x={WIDE_X[i + 1] + 74} y="84" className="f-ink">
							{l.name}
						</text>
					))}
					<text x="978" y="84" className="f-on-hi">
						Your row
					</text>
				</g>
				<g fontSize="10.5" textAnchor="middle">
					<text x="66" y="102" className="f-sub">
						trusted as-is
					</text>
					{LINKS.map((l, i) => (
						<text key={l.name} x={WIDE_X[i + 1] + 74} y="102" className="f-sub">
							{l.note}
						</text>
					))}
					<text x="978" y="102" className="f-on-hi">
						matches a proven leaf
					</text>
				</g>
				<g>
					{[262, 436, 610, 784, 978].map((cx) => (
						<circle key={cx} cx={cx} cy="30" r="10" className="f-ok" />
					))}
				</g>
				<path
					d="M257 30l3.5 3.5 6.5-7M431 30l3.5 3.5 6.5-7M605 30l3.5 3.5 6.5-7M779 30l3.5 3.5 6.5-7M973 30l3.5 3.5 6.5-7"
					fill="none"
					className="s-paper"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<rect
					x="0.5"
					y="146.5"
					width="131"
					height="21"
					rx="10.5"
					className="f-paper s-sub"
					strokeWidth="1"
					strokeDasharray="3 3"
				/>
				<text
					x="66"
					y="161"
					fontSize="10.5"
					textAnchor="middle"
					className="f-ink"
				>
					Stacks 8,956,304
				</text>
				<text x="146" y="161" fontSize="10.5" className="f-sub">
					Bitcoin 967,680 · cycle 143 signers · pass --checkpoint to trust your
					own
				</text>
			</svg>

			<svg
				className="asset chain-tall"
				viewBox="0 0 320 470"
				role="img"
				aria-label={LABEL_TALL}
			>
				<g strokeWidth="1" fill="none">
					<rect
						x="0.5"
						y="0.5"
						width="300"
						height="56"
						rx="8"
						className="f-paper s-sub"
						strokeDasharray="4 3"
					/>
					{LINKS.map((l, i) => (
						<rect
							key={l.name}
							x="0.5"
							y={80.5 + i * 80}
							width="300"
							height="56"
							rx="8"
							className="f-paper s-ink"
						/>
					))}
					<rect x="0" y="400" width="301" height="57" rx="8" className="f-hi" />
					<path
						d="M150.5 57v23M150.5 137v23M150.5 217v23M150.5 297v23M150.5 377v23"
						className="s-ink"
					/>
				</g>
				<g fontSize="12.5">
					<text x="16" y="25" className="f-sub">
						Checkpoint
					</text>
					{LINKS.map((l, i) => (
						<text key={l.name} x="16" y={105 + i * 80} className="f-ink">
							{l.name}
						</text>
					))}
					<text x="16" y="425" className="f-on-hi">
						Your row
					</text>
				</g>
				<g fontSize="10">
					<text x="16" y="43" className="f-sub">
						Stacks 8,956,304 · trusted as-is
					</text>
					{LINKS.map((l, i) => (
						<text key={l.name} x="16" y={123 + i * 80} className="f-sub">
							{l.note}
						</text>
					))}
					<text x="16" y="443" className="f-on-hi">
						matches a proven leaf
					</text>
				</g>
				<g>
					{[108, 188, 268, 348, 428].map((cy) => (
						<circle key={cy} cx="276" cy={cy} r="9" className="f-ok" />
					))}
				</g>
				<path
					d="M271.5 108l3 3 6-6.5M271.5 188l3 3 6-6.5M271.5 268l3 3 6-6.5M271.5 348l3 3 6-6.5M271.5 428l3 3 6-6.5"
					fill="none"
					className="s-paper"
					strokeWidth="1.7"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</>
	);
}
