import { Notation } from "@/components/notation";

/**
 * Index (L2 decoded) data-flow diagram.
 * The L2 decoder consumes Streams → decoded events → Index API → your app.
 */
export function IndexDiagram() {
	return (
		<figure className="sl-diagram-figure">
			<div className="sl-diagram-frame">
				<div className="sl-diagram-inner">
					<svg
						className="sl-diagram"
						viewBox="0 0 690 150"
						role="img"
						aria-label="The L2 decoder consumes the Streams firehose into normalized decoded events, served by the Index API to your app."
					>
						<defs>
							<marker
								id="sl-index-ar"
								viewBox="0 0 10 10"
								refX="8.5"
								refY="5"
								markerWidth="6"
								markerHeight="6"
								orient="auto-start-reverse"
							>
								<path
									d="M1 1L9 5L1 9"
									fill="none"
									stroke="context-stroke"
									strokeWidth="1.6"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</marker>
						</defs>

						<path
							className="edge"
							d="M164,75 H190"
							markerEnd="url(#sl-index-ar)"
						/>
						<path
							className="edge acc"
							d="M346,75 H372"
							markerEnd="url(#sl-index-ar)"
						/>
						<path
							className="edge acc"
							d="M512,75 H538"
							markerEnd="url(#sl-index-ar)"
						/>

						<g className="node">
							<rect x="14" y="48" width="150" height="54" rx="9" />
							<text className="nt" x="89" y="72" textAnchor="middle">
								L2 decoder
							</text>
							<text className="ns" x="89" y="88" textAnchor="middle">
								reads Streams
							</text>
						</g>
						<g className="node data">
							<rect x="190" y="46" width="156" height="58" rx="9" />
							<text className="nt" x="268" y="70" textAnchor="middle">
								Decoded events
							</text>
							<text className="ns" x="268" y="86" textAnchor="middle">
								stx · ft · nft · print
							</text>
						</g>
						<g className="node api">
							<rect x="372" y="48" width="140" height="54" rx="9" />
							<text className="nt" x="442" y="72" textAnchor="middle">
								Index
							</text>
							<text className="ns" x="442" y="88" textAnchor="middle">
								/v1/index
							</text>
						</g>
						<g className="node">
							<rect x="538" y="48" width="138" height="54" rx="9" />
							<text className="nt" x="607" y="72" textAnchor="middle">
								Your app
							</text>
							<text className="ns" x="607" y="88" textAnchor="middle">
								filter · paginate
							</text>
						</g>
					</svg>
				</div>
			</div>

			<p className="sl-diagram-note">
				<Notation
					type="underline"
					color="var(--accent)"
					strokeWidth={1.5}
					padding={3}
				>
					decoded once — query forever
				</Notation>
			</p>
		</figure>
	);
}
