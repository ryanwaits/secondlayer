import { Notation } from "@/components/notation";

/**
 * Subgraphs data-flow diagram.
 * Your config + raw (+ decoded) chain events → your handlers → your typed
 * tables → /v1/subgraphs → your app.
 */
export function SubgraphsDiagram() {
	return (
		<figure className="sl-diagram-figure">
			<div className="sl-diagram-frame">
				<div className="sl-diagram-inner">
					<svg
						className="sl-diagram"
						viewBox="0 0 690 132"
						role="img"
						aria-label="A config and raw (plus decoded) chain events feed your subgraph handlers, which write your typed tables served at /v1/subgraphs to your app."
					>
						<defs>
							<marker
								id="sl-subgraphs-ar"
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
							d="M186,92 H212"
							markerEnd="url(#sl-subgraphs-ar)"
						/>
						<path
							className="edge"
							d="M300,52 V70"
							markerEnd="url(#sl-subgraphs-ar)"
						/>
						<path
							className="edge acc"
							d="M388,92 H414"
							markerEnd="url(#sl-subgraphs-ar)"
						/>
						<path
							className="edge acc"
							d="M576,92 H602"
							markerEnd="url(#sl-subgraphs-ar)"
						/>

						<g className="node">
							<rect
								x="226"
								y="14"
								width="148"
								height="38"
								rx="8"
								style={{ fill: "var(--code-bg)", stroke: "var(--border)" }}
							/>
							<text
								className="ns"
								x="300"
								y="37"
								textAnchor="middle"
								style={{ fill: "var(--text-muted)" }}
							>
								subgraph.config.ts
							</text>
						</g>
						<g className="node data">
							<rect x="14" y="64" width="172" height="56" rx="9" />
							<text className="nt" x="100" y="88" textAnchor="middle">
								Raw events
							</text>
							<text className="ns" x="100" y="104" textAnchor="middle">
								raw (+ decoded)
							</text>
						</g>
						<g className="node">
							<rect x="212" y="64" width="176" height="56" rx="9" />
							<text className="nt" x="300" y="88" textAnchor="middle">
								Your handlers
							</text>
							<text className="ns" x="300" y="104" textAnchor="middle">
								defineSubgraph()
							</text>
						</g>
						<g className="node api">
							<rect x="414" y="64" width="162" height="56" rx="9" />
							<text className="nt" x="495" y="88" textAnchor="middle">
								Your tables
							</text>
							<text className="ns" x="495" y="104" textAnchor="middle">
								/v1/subgraphs · typed
							</text>
						</g>
						<g className="node">
							<rect x="602" y="66" width="74" height="52" rx="9" />
							<text className="nt" x="639" y="96" textAnchor="middle">
								App
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
					your shape, not a fixed one
				</Notation>
			</p>
		</figure>
	);
}
