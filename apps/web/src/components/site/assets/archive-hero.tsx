/** Signed partitions and the zero-gap arithmetic. Snapshot figures dated 2026-09-09. */
export function ArchiveHero() {
	return (
		<svg
			viewBox="0 0 460 400"
			role="img"
			aria-label="Three signed partition files for blocks, transactions and events, sealed by one ed25519 manifest, with the zero-gap arithmetic: 8,948,507 blocks over the span 0 to 8,948,506"
		>
			<g strokeWidth="1">
				<rect
					x="20"
					y="40"
					width="300"
					height="56"
					rx="8"
					className="f-paper s-ink"
				/>
				<rect
					x="20"
					y="108"
					width="300"
					height="56"
					rx="8"
					className="f-paper s-ink"
				/>
				<rect
					x="20"
					y="176"
					width="300"
					height="56"
					rx="8"
					className="f-paper s-ink"
				/>
			</g>
			<g fontSize="12">
				<text x="40" y="64" className="f-ink">
					blocks/
				</text>
				<text x="300" y="64" textAnchor="end" className="f-sub">
					3.15%
				</text>
				<text x="40" y="83" className="f-sub" fontSize="10.5">
					8940000-8949999-e4ea….parquet
				</text>
				<text x="40" y="132" className="f-ink">
					transactions/
				</text>
				<text x="300" y="132" textAnchor="end" className="f-sub">
					10.31%
				</text>
				<text x="40" y="151" className="f-sub" fontSize="10.5">
					8940000-8949999-9b1c….parquet
				</text>
				<text x="40" y="200" className="f-ink">
					events/
				</text>
				<text x="300" y="200" textAnchor="end" className="f-sub">
					86.53%
				</text>
				<text x="40" y="219" className="f-sub" fontSize="10.5">
					8940000-8949999-03d7….parquet
				</text>
			</g>
			<g className="s-sub" strokeWidth="1" fill="none">
				<path d="M320 68h46v136h-46M366 136h20" />
			</g>
			<circle cx="414" cy="136" r="34" className="f-hi" />
			<text
				x="414"
				y="132"
				fontSize="11"
				textAnchor="middle"
				className="f-on-hi"
			>
				signed
			</text>
			<text
				x="414"
				y="147"
				fontSize="10"
				textAnchor="middle"
				className="f-on-hi"
			>
				ed25519
			</text>
			<path d="M20 268h420" className="s-line" strokeWidth="1" />
			<g fontSize="13">
				<text x="20" y="300" className="f-sub">
					blocks
				</text>
				<text x="440" y="300" textAnchor="end" className="f-ink">
					8,948,507
				</text>
				<text x="20" y="326" className="f-sub">
					span 0 → 8,948,506
				</text>
				<text x="440" y="326" textAnchor="end" className="f-ink">
					8,948,507
				</text>
			</g>
			<path d="M300 340h140" className="s-ink" strokeWidth="1" />
			<rect x="20" y="352" width="420" height="30" rx="4" className="f-ink" />
			<text
				x="230"
				y="372"
				fontSize="12"
				textAnchor="middle"
				className="f-paper"
			>
				difference 0 · no room for a gap
			</text>
		</svg>
	);
}
