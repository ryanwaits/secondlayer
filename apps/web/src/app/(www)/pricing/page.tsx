import { CtaPill } from "@/components/home/cta-pill";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Pricing · secondlayer",
	description:
		"Free is the product, paid is the headroom. Rate-limited public reads for everyone and a permanent free tier.",
};

const FREE_INCLUDES = [
	"Public reads on Index (no key needed) and Streams (with a free ghost key) — rate-limited either way",
	"Ghost keys: curl -X POST /v1/keys, no signup, claim with an email within 30 days",
	"Public subgraphs — live indexing forward from the moment you deploy",
	"3 webhook subscriptions",
	"Signed Streams bulk dumps for cold-lane replay",
	"MCP server + agent skills",
	"Community support",
];

// Every claim below maps to an enforced limit — if code doesn't enforce it,
// it doesn't go on a card.
const PAID_TIERS = [
	{
		name: "Pro",
		price: "$99",
		per: "/mo",
		hot: true,
		summary:
			"250 req/s on Index and Streams · private subgraphs · genesis backfills (full history) · 25 webhook subscriptions + replay · usage budgets · email support",
	},
	{
		name: "Enterprise",
		price: "Contact us",
		per: "",
		hot: false,
		summary:
			"Custom rates + dedicated capacity · priority indexing for your contracts · SLA + incident channel · invoicing + security review",
	},
];

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
						Free is the product.
						<br />
						Paid is the headroom.
					</>
				}
			>
				Public reads are rate-limited for everyone and the free tier is
				permanent. Paid plans buy capacity and guarantees, never access to
				public data.
			</MarketingPageHeader>

			<div className="prc-beta">
				<span className="b">Open beta</span>
				<p>
					Nothing is charged today — everything below is{" "}
					<strong>$0 until beta ends</strong>. Plans show what billing will look
					like.
				</p>
			</div>

			<div className="prc-split">
				<div className="prc-free">
					<span className="prc-stamp" aria-hidden="true">
						forever!
					</span>
					<h3>Free</h3>
					<p className="prc-free-price">$0</p>
					<ul>
						{FREE_INCLUDES.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
					<Link href="/" className="auth-bar-cta prc-free-cta">
						Mint a key
					</Link>
				</div>
				<div className="prc-paid">
					{PAID_TIERS.map((t) => (
						<div className={`prc-tier${t.hot ? " hot" : ""}`} key={t.name}>
							<div>
								<p className="n">{t.name}</p>
								<p className="d">{t.summary}</p>
							</div>
							<p className="pr">
								{t.price}
								{t.per && <small>{t.per}</small>}
							</p>
						</div>
					))}
					<Link className="prc-xjump" href="/docs/x402">
						<span>Experimental</span>
						<p>
							Agents can pay per call with x402 — no account, settled on
							Stacks. Beta, deliberately quiet. Read how it works →
						</p>
					</Link>
				</div>
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
