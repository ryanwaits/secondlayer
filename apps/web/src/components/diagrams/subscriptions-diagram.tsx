import { Notation } from "@/components/notation";

/**
 * Subscriptions (push) data-flow diagram.
 * A matching subgraph-table row fires a signed, retried webhook to your endpoint.
 */
export function SubscriptionsDiagram() {
	return (
		<figure className="sl-diagram-figure">
			<div className="sl-diagram-frame">
				<div className="sl-diagram-inner">
					<svg
						className="sl-diagram"
						viewBox="0 0 690 150"
						role="img"
						aria-label="A matching subgraph-table row triggers a subscription that delivers a signed, retried webhook to your endpoint."
					>
						<defs>
							<marker
								id="sl-subscriptions-ar"
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
							className="edge acc"
							d="M196,75 H222"
							markerEnd="url(#sl-subscriptions-ar)"
						/>
						<path
							className="edge acc"
							d="M410,75 H436"
							markerEnd="url(#sl-subscriptions-ar)"
						/>

						<g className="node data">
							<rect x="14" y="46" width="182" height="58" rx="9" />
							<text className="nt" x="105" y="70" textAnchor="middle">
								Subgraph row
							</text>
							<text className="ns" x="105" y="86" textAnchor="middle">
								matches your filter
							</text>
						</g>
						<g className="node api">
							<rect x="222" y="48" width="188" height="54" rx="9" />
							<text className="nt" x="316" y="72" textAnchor="middle">
								Subscription
							</text>
							<text className="ns" x="316" y="88" textAnchor="middle">
								signed · retried
							</text>
						</g>
						<g className="node">
							<rect x="436" y="48" width="160" height="54" rx="9" />
							<text className="nt" x="516" y="72" textAnchor="middle">
								Your endpoint
							</text>
							<text className="ns" x="516" y="88" textAnchor="middle">
								Discord · Slack · anything
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
					push, not poll
				</Notation>
			</p>
		</figure>
	);
}
