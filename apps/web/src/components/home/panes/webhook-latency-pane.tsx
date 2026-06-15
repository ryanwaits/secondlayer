"use client";

import { LivePane } from "../live-pane";

/**
 * Subscriptions demo: an on-chain event fires → a signed payload is pushed to
 * your endpoint → 200, signature verified. The wire animates (CSS-only) so the
 * push reads as live. Mirrors the other home panes' LivePane shell + tokens.
 */
export function WebhookLatencyPane() {
	return (
		<div>
			<LivePane dot="green" title="whale-alerts" right="1 trigger matched">
				<div className="home-hook">
					<div className="home-hook-flow">
						<div className="home-hook-node home-hook-event">
							<span className="home-hook-kicker">
								<span className="home-hook-glyph" /> On-chain event
							</span>
							<div className="home-hook-line">
								<span className="k">event</span>{" "}
								<span className="v">ft_transfer</span>
							</div>
							<div className="home-hook-line">
								<span className="amt">1.20 sBTC</span>
							</div>
							<div className="home-hook-line">
								<span className="k">from</span>{" "}
								<span className="v">SP2J6…X0G</span>
							</div>
							<div className="home-hook-line">
								<span className="k">tx</span>{" "}
								<span className="v">0x9f3c41…</span>
							</div>
						</div>

						<div className="home-hook-wire">
							<svg
								viewBox="0 0 86 56"
								preserveAspectRatio="none"
								aria-hidden="true"
							>
								<path className="home-hook-track" d="M2 28 H84" />
								<path className="home-hook-dash" d="M2 28 H84" />
								<g className="home-hook-packet">
									<rect x="2" y="23" width="10" height="10" rx="2" />
								</g>
							</svg>
							<span className="home-hook-tag">POST · signed</span>
						</div>

						<div className="home-hook-node home-hook-endpoint">
							<span className="home-hook-kicker">Your endpoint</span>
							<div className="home-hook-url">hooks.example.com/sbtc</div>
							<div className="home-hook-row">
								<span className="lbl">status</span>
								<span className="ok">200 OK</span>
							</div>
							<div className="home-hook-row">
								<span className="lbl">verified</span>
								<span className="ok chk">✓ signature</span>
							</div>
						</div>
					</div>

					<div className="home-hook-foot">
						<span>
							<span className="sig">webhook-signature</span> t=1718…,v1=k38f…
						</span>
						<span>delivered · 84ms</span>
					</div>
				</div>
			</LivePane>
		</div>
	);
}
