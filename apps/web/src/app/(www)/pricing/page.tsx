import { CtaPill } from "@/components/home/cta-pill";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "Pricing · secondlayer",
	description:
		"Free is the product, paid is the headroom. Rate-limited public reads for everyone and a permanent free tier.",
	image: "/og/pricing.png",
	path: "/pricing",
});

const FREE_INCLUDES = [
	"Rate-limited public reads on Index and Streams",
	"Ghost keys from your terminal, no signup",
	"Public subgraphs, live from deploy",
	"3 webhook subscriptions",
	"Signed Streams bulk dumps",
	"MCP server + agent skills",
];

// Every claim below maps to an enforced limit. If code doesn't enforce it,
// it doesn't go on a card.
const PRO_INCLUDES = [
	"Private subgraphs",
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
		a: "Rate-limited public reads — anonymous on Index, with a free key on Streams — plus signed bulk dumps and the free tier above. Public data stays public.",
	},
	{
		q: "What does a paid plan actually buy?",
		a: "Capacity and guarantees: a bigger request budget under your own key, more subgraphs (including private ones), full genesis backfills instead of forward-only indexing, longer webhook retention, support and SLAs. Never access to public data.",
	},
	{
		q: "When does billing start?",
		a: "When open beta ends, with notice. Usage dashboards ship first, so you can see exactly where you'd land before a card is ever involved.",
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
						Pay for headroom.
					</>
				}
			>
				Public reads are rate-limited for everyone and the free tier is
				permanent. Paid plans buy capacity and guarantees, never access to
				public data.
			</MarketingPageHeader>

			<div className="prc-cta-band">
				<div className="prc-cta-band-copy">
					<p className="prc-cta-band-title">Start free — no signup, no card.</p>
					<p className="prc-cta-band-sub">
						Mint a key from your terminal and you're indexing in minutes.
					</p>
				</div>
				<CtaPill />
			</div>

			<div className="prc-split">
				<div className="prc-plan prc-free">
					<span className="prc-plan-eyebrow">Free · forever</span>
					<p className="prc-plan-price">$0</p>
					<ul>
						{FREE_INCLUDES.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
					<Link href="/login" className="prc-plan-cta prc-cta-ghost">
						Mint a key
					</Link>
				</div>
				<div className="prc-plan prc-pro">
					<span className="prc-plan-eyebrow">Pro · most teams pick this</span>
					<p className="prc-plan-price">
						$99<small>/mo</small>
					</p>
					<p className="prc-plan-cont">Everything in Free, plus</p>
					<ul>
						{PRO_INCLUDES.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
					<Link href="/login" className="prc-plan-cta prc-cta-pro">
						Start Pro
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
