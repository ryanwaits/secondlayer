import { CtaPill } from "@/components/home/cta-pill";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";
import { CreditsBuy } from "../credits-buy";

export const metadata: Metadata = socialMeta({
	title: "Pricing · secondlayer",
	description:
		"The runtime is MIT. The signed archive is public to check. Large restore and backfill off our R2 is metered.",
	image: "/og/pricing.png",
	path: "/pricing",
});

const FREE = [
	"Postgres plus one container",
	"Forward-only from your node",
	"secondlayer verify and secondlayer repair against the public archive",
	"Index, Streams, Subgraphs, and webhooks on your instance",
];

const METERED = [
	"Official-archive bootstrap from our R2",
	"Backfill and reindex that reads our R2",
	"Packs of $10, $25, $50, or $100",
	"Prepaid balance is the cap. Auto-refill is off until you set it",
];

const FAQ = [
	{
		q: "What do I pay for?",
		a: "Nothing to run the box. Credits cover large restore and backfill off our R2. Checking the signed archive is free.",
	},
	{
		q: "How do I buy credits?",
		a: "The form on this page, the History block on the home page, or secondlayer credits buy --email you@example.com --pack 25.",
	},
	{
		q: "Is there a hosted plan?",
		a: "No. You operate the instance. We operate the signed archive.",
	},
];

export default function PricingPage() {
	return (
		<main className="explore-wrap">
			<MarketingPageHeader
				title={
					<>
						Runtime is free.
						<br />
						Archive work is metered.
					</>
				}
			>
				Self-host the stack. Buy credits only when you restore or backfill from
				our R2.
			</MarketingPageHeader>

			<div className="prc-split">
				<div className="prc-plan prc-free">
					<span className="prc-plan-eyebrow">Self-host · MIT</span>
					<p className="prc-plan-price">$0</p>
					<p className="prc-plan-cont">You run the instance.</p>
					<ul>
						{FREE.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
					<Link
						href="/docs/self-host"
						className="prc-plan-cta pp-btn pp-btn-ghost"
					>
						Self-host
					</Link>
				</div>
				<div className="prc-plan prc-pro">
					<span className="prc-plan-eyebrow">Archive credits</span>
					<p className="prc-plan-price">
						$10–$100<small> packs</small>
					</p>
					<p className="prc-plan-cont">Prepaid. Hard cap.</p>
					<ul>
						{METERED.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
					<Link href="/docs/archive" className="prc-plan-cta pp-btn pp-btn-ink">
						Verified archive
					</Link>
				</div>
			</div>

			<div className="prc-cta-band">
				<div className="prc-cta-band-copy">
					<p className="prc-cta-band-title">Buy credits</p>
					<p className="prc-cta-band-sub">
						Email gets the receipt. CLI is the same packs.
					</p>
				</div>
				<CreditsBuy />
			</div>

			<div className="prc-below" id="pay-per-call">
				<Link className="prc-xfoot" href="/docs/x402">
					<span className="prc-xfoot-row">
						<span className="prc-xfoot-title">x402 pay-per-call</span>
						<span className="prc-xfoot-tag">Experimental</span>
					</span>
					<p>
						Operator-owned on your instance. We are not the merchant. Read how
						it works →
					</p>
				</Link>
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
					Your node. Your schema.
				</h2>
				<div className="home-ctas">
					<CtaPill />
				</div>
			</div>
		</main>
	);
}
