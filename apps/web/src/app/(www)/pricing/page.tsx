import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Pricing · secondlayer",
	description:
		"Free during open beta. Every product, every Foundation Dataset, the full API — no plan to pick, no card required. Paid plans arrive after beta.",
};

const INCLUDED_EVERYWHERE = [
	"All five Foundation Datasets",
	"Public APIs, parquet bulk dumps, public status",
	"Subgraphs, Streams, Index, Subscriptions",
	"SDKs (TypeScript, Python, Go), CLI, MCP server",
	"Cursor APIs, idempotent ingest, deterministic replay",
];

const AFTER_BETA = [
	"Dedicated compute you can resize independently of plan",
	"Higher rate limits and longer log retention",
	"Soft spend caps with 80% threshold alerts — no surprise bills",
	"A free tier stays, forever",
];

export default function PricingPage() {
	return (
		<div className="www-page www-pricing">
			<a className="www-skip-link" href="#main">
				Skip to content
			</a>
			<header className="www-topbar">
				<div className="www-mark">
					<span className="www-mark-dot" aria-hidden="true" />
					<Link
						href="/"
						className="www-mark-text"
						aria-label="secondlayer home"
					>
						secondlayer
					</Link>
				</div>
				<nav className="www-nav" aria-label="Primary">
					<Link href="/datasets">datasets</Link>
					<Link href="/pricing" aria-current="page">
						pricing
					</Link>
					<Link href="/docs">docs</Link>
					<Link href="/platform" className="www-nav-cta">
						sign in →
					</Link>
				</nav>
			</header>

			<main id="main">
				<section
					className="www-pricing-hero"
					aria-labelledby="pricing-hero-title"
				>
					<div className="www-eyebrow">
						<span className="www-eyebrow-tick" aria-hidden="true" />
						<span>Pricing</span>
					</div>
					<h1 id="pricing-hero-title" className="www-hero-title">
						Free while we&rsquo;re
						<br />
						in beta.
					</h1>
					<p className="www-hero-sub">
						Every product, every Foundation Dataset, and the full API are free
						during open beta. No plan to pick, no card required. Paid plans
						arrive after beta — and a free tier stays.
					</p>
					<div className="www-cta-row" style={{ marginTop: 28 }}>
						<Link href="/platform" className="www-btn www-btn-primary">
							Start free
						</Link>
						<Link href="/docs" className="www-btn">
							Read the docs
						</Link>
					</div>
				</section>

				<section className="www-section">
					<div className="www-section-head">
						<div className="www-section-num">included</div>
						<h2 className="www-section-title">Everything ships in the box.</h2>
						<p className="www-section-sub">
							We don&rsquo;t gate products behind plans. During beta the whole
							surface is open to everyone.
						</p>
					</div>
					<ul className="www-included">
						{INCLUDED_EVERYWHERE.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</section>

				<section className="www-section">
					<div className="www-section-head">
						<div className="www-section-num">after beta</div>
						<h2 className="www-section-title">What paid plans will add.</h2>
						<p className="www-section-sub">
							When beta ends, paid plans bundle dedicated resources and the
							guardrails production workloads need. Nothing changes for
							free-tier builders.
						</p>
					</div>
					<ul className="www-included">
						{AFTER_BETA.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</section>

				<section className="www-cta-bottom">
					<h2 className="www-cta-bottom-title">
						Building something now?
						<br />
						Start free — it stays free through beta.
					</h2>
					<div className="www-cta-row">
						<Link href="/platform" className="www-btn www-btn-primary">
							Start free
						</Link>
						<Link href="mailto:hi@secondlayer.tools" className="www-btn">
							Talk to us
						</Link>
					</div>
				</section>
			</main>
		</div>
	);
}
