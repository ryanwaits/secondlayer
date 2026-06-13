import { CtaPill } from "@/components/home/cta-pill";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "Pricing · secondlayer",
	description:
		"Reads are keyless and free for everyone. Pay when you want it hosted — your tables, webhooks, and backfills on our infra. The whole stack is also MIT to self-host.",
	image: "/og/pricing.png",
	path: "/pricing",
});

const FREE_INCLUDES = [
	"Keyless decoded reads on Index and Streams",
	"Ghost keys from your terminal, no signup",
	"Signed Streams bulk dumps",
	"MCP server + agent skills",
];

// Every claim below maps to an enforced limit. If code doesn't enforce it,
// it doesn't go on a card.
const PRO_INCLUDES = [
	"Deploy subgraphs — public and private",
	"Genesis backfills (full history)",
	"25 webhook subscriptions + replay",
	"250 req/s on Index and Streams",
	"Usage budgets",
	"Email support",
];

const ENTERPRISE_SUMMARY =
	"Custom rates + dedicated resources. Priority indexing for your contracts + incident channels.";

const FAQ = [
	{
		q: "What stays free forever?",
		a: "Keyless public reads — anonymous on Index, with a free key on Streams — plus signed bulk dumps. No account, no card. Public data stays public.",
	},
	{
		q: "What does a paid plan actually buy?",
		a: "We host it for you: deploy public and private subgraphs, full genesis backfills, webhooks with replay, a bigger request budget, usage budgets, and support — provisioned and on-call on our infra. Never access to public data; reads are free either way.",
	},
	{
		q: "How does the trial work?",
		a: "Every paid plan opens with a 14-day trial — card on file, cancel anytime. Usage dashboards show exactly where you'd land before anything bills.",
	},
	{
		q: "Can I run it myself?",
		a: "Yes — the whole stack is MIT-licensed. docker compose up runs the indexer, API, and processor on your own hardware. Paid plans are for when you'd rather we run it.",
	},
];

export default function PricingPage() {
	return (
		<main className="explore-wrap">
			<MarketingPageHeader
				crumb="Home"
				crumbHref="/"
				here="Pricing"
				title={
					<>
						Reads are free.
						<br />
						Hosting is paid.
					</>
				}
			>
				Keyless decoded reads are free for everyone — no account, no card. When
				you want it run for you — your tables, webhooks, and backfills on our
				infra — that's Pro at $99/mo. The whole stack is MIT, so self-hosting is
				always an option.
			</MarketingPageHeader>

			<div className="prc-cta-band">
				<div className="prc-cta-band-copy">
					<p className="prc-cta-band-title">Read free — no signup, no card.</p>
					<p className="prc-cta-band-sub">
						Curl decoded data in ten seconds, or grab the SDK.
					</p>
				</div>
				<CtaPill />
			</div>

			<div className="prc-split">
				<div className="prc-plan prc-free">
					<span className="prc-plan-eyebrow">Free · no account</span>
					<p className="prc-plan-price">$0</p>
					<ul>
						{FREE_INCLUDES.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
					<Link href="/docs" className="prc-plan-cta prc-cta-ghost">
						Start reading
					</Link>
				</div>
				<div className="prc-plan prc-pro">
					<span className="prc-plan-eyebrow">Pro · most teams pick this</span>
					<p className="prc-plan-price">
						$99<small>/mo</small>
					</p>
					<p className="prc-plan-cont">We host it. You ship.</p>
					<ul>
						{PRO_INCLUDES.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
					<Link href="/login" className="prc-plan-cta prc-cta-pro">
						Start 14-day trial
					</Link>
				</div>
			</div>

			<div className="prc-below">
				<Link className="prc-xfoot" href="/docs/x402">
					<span className="prc-xfoot-row">
						<span className="prc-xfoot-title">x402 pay-per-call</span>
						<span className="prc-xfoot-tag">Experimental</span>
					</span>
					<p>
						Agents can pay per call with x402 — no account, settled on Stacks.
						Read how it works →
					</p>
				</Link>
				<a className="prc-xfoot" href="mailto:hello@secondlayer.tools">
					<span className="prc-xfoot-row">
						<span className="prc-xfoot-title">Contact Us</span>
						<span className="prc-xfoot-tag">Enterprise</span>
					</span>
					<p>{ENTERPRISE_SUMMARY} →</p>
				</a>
			</div>

			<h2 className="prc-h2">The fine print, up front.</h2>
			<div className="prc-faq">
				{FAQ.map((f) => (
					<div className="qa" key={f.q}>
						<h5>{f.q}</h5>
						<p>{f.a}</p>
					</div>
				))}
			</div>

			<div className="prc-fin">
				<h2 className="prc-h2" style={{ marginTop: 0 }}>
					Start free. Decide later.
				</h2>
				<div className="home-ctas">
					<CtaPill />
				</div>
			</div>
		</main>
	);
}
