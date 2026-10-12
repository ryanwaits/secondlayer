/** A consumer reading events in order with a saved cursor. Illustrative values. */
export function StreamsHero() {
	return (
		<svg
			viewBox="0 0 460 400"
			role="img"
			aria-label="A consumer reading events in order. Five events are shown by block height and event index; the third, 8948507:03, is the saved cursor. Finalized blocks are marked; the last two events sit above the finalized height."
		>
			<text x="20" y="34" fontSize="11.5" className="f-sub">
				block_height
			</text>
			<rect x="20" y="48" width="244" height="22" rx="4" className="f-hi" />
			<text x="32" y="63" fontSize="11.5" className="f-on-hi">
				finalized · 6 btc conf
			</text>
			<g strokeWidth="1">
				<rect
					x="20"
					y="82"
					width="116"
					height="40"
					rx="4"
					className="f-soft s-ink"
				/>
				<rect
					x="148"
					y="82"
					width="116"
					height="40"
					rx="4"
					className="f-soft s-ink"
				/>
				<rect
					x="276"
					y="82"
					width="116"
					height="40"
					rx="4"
					className="f-paper s-sub"
					strokeDasharray="4 3"
				/>
			</g>
			<g fontSize="12.5" textAnchor="middle">
				<text x="78" y="106" className="f-ink">
					8,948,506
				</text>
				<text x="206" y="106" className="f-ink">
					8,948,507
				</text>
				<text x="334" y="106" className="f-sub">
					8,948,508
				</text>
			</g>
			<text x="404" y="106" fontSize="12" className="f-sub">
				tip
			</text>

			<g className="s-line" strokeWidth="1">
				<path d="M48 122v36M108 122v36M176 122v36M236 122v36M334 122v36" />
			</g>
			<g strokeWidth="1">
				<rect
					x="20"
					y="158"
					width="76"
					height="54"
					rx="4"
					className="f-paper s-line"
				/>
				<rect
					x="104"
					y="158"
					width="76"
					height="54"
					rx="4"
					className="f-paper s-line"
				/>
				<rect x="188" y="158" width="76" height="54" rx="4" className="f-pri" />
				<rect
					x="272"
					y="158"
					width="76"
					height="54"
					rx="4"
					className="f-paper s-sub"
					strokeDasharray="4 3"
				/>
				<rect
					x="356"
					y="158"
					width="76"
					height="54"
					rx="4"
					className="f-paper s-sub"
					strokeDasharray="4 3"
				/>
			</g>
			<g fontSize="11.5" textAnchor="middle">
				<text x="58" y="182" className="f-ink">
					506:19
				</text>
				<text x="58" y="200" className="f-sub">
					read
				</text>
				<text x="142" y="182" className="f-ink">
					506:24
				</text>
				<text x="142" y="200" className="f-sub">
					read
				</text>
				<text x="226" y="182" className="f-on-pri">
					507:03
				</text>
				<text x="226" y="200" className="f-on-pri">
					cursor
				</text>
				<text x="310" y="182" className="f-sub">
					507:08
				</text>
				<text x="310" y="200" className="f-sub">
					next
				</text>
				<text x="394" y="182" className="f-sub">
					…
				</text>
				<text x="394" y="200" className="f-sub">
					tip
				</text>
			</g>
			<path d="M226 212v34" className="s-ink" strokeWidth="1" />

			<rect
				x="20"
				y="246"
				width="412"
				height="104"
				rx="8"
				className="f-paper s-ink"
				strokeWidth="1"
			/>
			<text x="38" y="274" fontSize="11.5" className="f-sub">
				your checkpoint
			</text>
			<text x="38" y="300" fontSize="15" className="f-ink">
				cursor = "8948507:03"
			</text>
			<text x="38" y="328" fontSize="11.5" className="f-sub">
				kill the process, pass --cursor, resume exactly here
			</text>
			<text x="20" y="384" fontSize="11" className="f-sub">
				two numbers order every event on the chain exactly once
			</text>
		</svg>
	);
}
