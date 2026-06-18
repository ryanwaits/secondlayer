import { CtaPill } from "@/components/home/cta-pill";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import { socialMeta } from "@/lib/og";
import { appUrl } from "@/lib/urls";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "Pricing · secondlayer",
	description:
		"Self-host the whole stack for $0 — it's MIT. Or let us host it: managed subgraphs, genesis backfills, and history on flat plans ($79/mo) or pay-as-you-go ($5/1M rows).",
	image: "/og/pricing.png",
	path: "/pricing",
});

const SELFHOST_INCLUDES = [
	"Containerized — indexer, API, processor",
	"Single-tenant, no rate limits",
	"Your hardware, your data",
];

// Every claim below maps to an enforced limit. If code doesn't enforce it,
// it doesn't go on a card.
const PRO_INCLUDES = [
	"Up to 15 subgraphs — public and private",
	"Genesis backfills (full history)",
	"25 webhook subscriptions + replay",
	"250 req/s on Index and Streams",
];

const SCALE_INCLUDES = [
	"Up to 50 subgraphs — public and private",
	"500 req/s on Index and Streams",
	"Heavy history + replay",
	"$2 / 1M rows at ≥10M rows/mo",
	"24h SLA · priority support",
];

const ENTERPRISE_SUMMARY =
	"$3–8k/mo, custom. Dedicated capacity, SLAs, regions, SSO, and a direct line to the team.";

const FAQ = [
	{
		q: "Can I run it myself?",
		a: "Yes — the whole stack is MIT-licensed. docker compose up runs the indexer, API, and processor on your own hardware, single-tenant, with no rate limits. Hosting is for when you'd rather we run it.",
	},
	{
		q: "What's pay-as-you-go?",
		a: "Top up prepaid credits with a card. Pulling history draws down at $5 per 1M rows — unthrottled, no subscription, across Index and Streams. The prepaid balance is the cap, so you never get a surprise bill.",
	},
	{
		q: "Do rates drop at volume?",
		a: "Yes. Once your monthly spend crosses $50 (≈ 10M rows), the per-row rate drops to $2 per 1M rows automatically — no new plan, no action needed. The lower rate applies for the rest of that month.",
	},
	{
		q: "What does flat Pro buy over pay-as-you-go?",
		a: "A predictable bill instead of metering: deploy public and private subgraphs, full genesis backfills, 250 req/s, 25 webhooks with replay, usage budgets, and support. Go credits if you'd rather only pay for what you pull; go Pro if you'd rather a fixed number.",
	},
	{
		q: "How does the trial work?",
		a: "Hosted Pro opens with a 14-day trial — card on file, cancel anytime. Usage dashboards show exactly where you'd land before anything bills.",
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
						Host it yourself.
						<br />
						Or don&apos;t.
					</>
				}
			>
				The whole stack is MIT — run the indexer, API, and processor on your own
				hardware, $0 forever. Or let us run it: managed subgraphs, genesis
				backfills, webhooks, and deep history, on flat plans or pay-as-you-go.
			</MarketingPageHeader>

			<div className="prc-split">
				<div className="prc-plan prc-free">
					<span className="prc-plan-eyebrow">Self-host · MIT</span>
					<p className="prc-plan-price">$0</p>
					<p className="prc-plan-cont">Run it yourself.</p>
					<ul>
						{SELFHOST_INCLUDES.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
					<Link
						href="/docs/self-host"
						className="prc-plan-cta pp-btn pp-btn-ghost"
						data-umami-event="pricing-plan-click"
						data-umami-event-plan="self-host"
					>
						Get started
					</Link>
				</div>
				<div className="prc-plan prc-pro">
					<span className="prc-plan-eyebrow">Pro · most teams pick this</span>
					<p className="prc-plan-price">
						$79<small>/mo</small>
					</p>
					<p className="prc-plan-cont">We host it. You ship.</p>
					<ul>
						{PRO_INCLUDES.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
					<Link
						href={appUrl("/login")}
						className="prc-plan-cta pp-btn pp-btn-ink"
						data-umami-event="pricing-plan-click"
						data-umami-event-plan="pro"
					>
						Start 14-day trial
					</Link>
				</div>
				<div className="prc-plan prc-scale">
					<span className="prc-plan-eyebrow">Scale · high-volume teams</span>
					<p className="prc-plan-price">
						$299<small>/mo</small>
					</p>
					<p className="prc-plan-cont">Talk to us — not self-serve.</p>
					<ul>
						{SCALE_INCLUDES.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
					<a
						href="mailto:hello@secondlayer.tools"
						className="prc-plan-cta pp-btn pp-btn-ghost"
						data-umami-event="pricing-plan-click"
						data-umami-event-plan="scale"
					>
						Contact us
					</a>
				</div>
			</div>

			<div className="prc-cta-band">
				<div className="prc-cta-band-copy">
					<p className="prc-cta-band-title">Or pay as you go.</p>
					<p className="prc-cta-band-sub">
						Need the full chain or more throughput? Top up prepaid credits and
						pull history unthrottled — $5 per 1M rows, no subscription.
					</p>
				</div>
				<Link
					href={appUrl("/login")}
					className="prc-plan-cta pp-btn pp-btn-ghost"
					data-umami-event="pricing-plan-click"
					data-umami-event-plan="credits"
				>
					Top up credits
				</Link>
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
				<a
					className="prc-xfoot"
					href="mailto:hello@secondlayer.tools"
					data-umami-event="pricing-plan-click"
					data-umami-event-plan="enterprise"
				>
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
					Self-host or hosted. Your call.
				</h2>
				<div className="home-ctas">
					<CtaPill />
				</div>
			</div>
		</main>
	);
}
