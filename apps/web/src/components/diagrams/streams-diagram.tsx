import { Notation } from "@/components/notation";

/**
 * Streams (L1) data-flow diagram — ported from the marketing mock.
 * Indexer (faces the node) → raw canonical events → Streams API → your consumer.
 */
export function StreamsDiagram() {
	return (
		<figure className="sl-diagram-figure">
			<div className="sl-diagram-frame">
				<div className="sl-diagram-inner">
					<svg
						className="sl-diagram"
						viewBox="0 0 690 150"
						role="img"
						aria-label="An indexer faces the Stacks node and writes canonical raw events, served by the Streams API to your consumer over a cursor."
					>
						<defs>
							<marker
								id="sl-streams-ar"
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
							d="M156,75 H182"
							markerEnd="url(#sl-streams-ar)"
						/>
						<path
							className="edge acc"
							d="M338,75 H364"
							markerEnd="url(#sl-streams-ar)"
						/>
						<path
							className="edge acc"
							d="M520,75 H546"
							markerEnd="url(#sl-streams-ar)"
						/>

						<g className="node">
							<rect x="14" y="48" width="142" height="54" rx="9" />
							<text className="nt" x="85" y="72" textAnchor="middle">
								Indexer
							</text>
							<text className="ns" x="85" y="88" textAnchor="middle">
								faces the node
							</text>
						</g>
						<g className="node data">
							<rect x="182" y="46" width="156" height="58" rx="9" />
							<text className="nt" x="260" y="70" textAnchor="middle">
								Raw events
							</text>
							<text className="ns" x="260" y="86" textAnchor="middle">
								canonical · ordered
							</text>
						</g>
						<g className="node api">
							<rect x="364" y="48" width="156" height="54" rx="9" />
							<text className="nt" x="442" y="72" textAnchor="middle">
								Streams API
							</text>
							<text className="ns" x="442" y="88" textAnchor="middle">
								/v1/streams
							</text>
						</g>
						<g className="node">
							<rect x="546" y="48" width="130" height="54" rx="9" />
							<text className="nt" x="611" y="72" textAnchor="middle">
								Your consumer
							</text>
							<text className="ns" x="611" y="88" textAnchor="middle">
								tail · replay
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
					so you never run a node
				</Notation>
			</p>
		</figure>
	);
}
