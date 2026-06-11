"use client";

import { type ReactNode, useState } from "react";

const STEPS = [
	{
		title: "Call without a key",
		body: (
			<>
				Call without a key while the pay-per-call rail is on and the API answers{" "}
				<code>402 Payment Required</code> with exact quotes per accepted token.
			</>
		),
	},
	{
		title: "Wrap fetch, hold a wallet",
		body: (
			<>
				One line with the SDK: <code>withX402(fetch, {"{ account }"})</code>. It
				selects an offer, signs the sponsored transfer —{" "}
				<strong>you pay zero gas</strong> — and retries for you.
			</>
		),
	},
	{
		title: "The paid retry",
		body: (
			<>
				Same request plus a <code>PAYMENT-SIGNATURE</code> header. The response
				streams immediately; settlement confirms on-chain behind it. On Streams,
				one payment opens a session — up to 500 polls in the next hour ride free
				on a <code>PAYMENT-SESSION</code> voucher.
			</>
		),
	},
	{
		title: "Read the receipt",
		body: (
			<>
				Every paid response carries a <code>PAYMENT-RESPONSE</code> receipt with
				txid, payer, and settlement state. Floor $0.001 per call.
			</>
		),
	},
];

/** Clickable x402 walkthrough: steps left, the matching pre-highlighted
 *  code pane (server-rendered Shiki, passed in as children) right. */
export function X402Steps({ panes }: { panes: ReactNode[] }) {
	const [active, setActive] = useState(0);
	return (
		<div className="prc-x-grid">
			<div className="prc-x-steps">
				{STEPS.map((s, i) => (
					<button
						type="button"
						key={s.title}
						className={`prc-x-step${i === active ? " on" : ""}`}
						onClick={() => setActive(i)}
						aria-expanded={i === active}
					>
						<span className="no">{i + 1}</span>
						<span>
							<h5>{s.title}</h5>
							<p>{s.body}</p>
						</span>
					</button>
				))}
			</div>
			<div className="prc-x-pane">
				{panes.map((pane, i) => (
					<div
						key={STEPS[i]?.title ?? i}
						className={i === active ? "prc-x-slide on" : "prc-x-slide"}
						aria-hidden={i !== active}
					>
						{pane}
					</div>
				))}
			</div>
		</div>
	);
}
