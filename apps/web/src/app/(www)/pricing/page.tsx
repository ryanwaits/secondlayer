import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Pricing · secondlayer",
	description:
		"Pay for compute, not features. Hobby is free forever. Compute scales independently from plan. Soft caps + 80% alerts on every paid tier.",
};

type Tier = {
	id: string;
	name: string;
	tagline: string;
	price: string;
	priceUnit: string;
	cta: { label: string; href: string };
	bullets: string[];
	emphasis?: "free" | "popular" | "enterprise";
};

const TIERS: Tier[] = [
	{
		id: "hobby",
		name: "Hobby",
		tagline: "For weekend builds, prototypes, learning.",
		price: "$0",
		priceUnit: "forever",
		cta: { label: "Start free", href: "/platform" },
		emphasis: "free",
		bullets: [
			"2 active projects per org",
			"Auto-pauses after 7 days idle, resume on first query",
			"Nano compute (0.5 vCPU · 512 MB · 5 GB)",
			"All Foundation Datasets — same as paid",
			"Discord community support",
		],
	},
	{
		id: "launch",
		name: "Launch",
		tagline: "First paid step. Small, real, predictable.",
		price: "$25",
		priceUnit: "/ org / mo",
		cta: { label: "Start Launch", href: "/platform?plan=launch" },
		bullets: [
			"Includes $10 / mo compute credit",
			"Soft spend cap + 80% threshold alerts",
			"Email support, 7-day log retention",
			"Resize compute independently — Micro / Small / Medium…",
			"All Foundation Datasets",
		],
	},
	{
		id: "grow",
		name: "Grow",
		tagline: "Production app, real users, real SLAs.",
		price: "$99",
		priceUnit: "/ org / mo",
		cta: { label: "Start Grow", href: "/platform?plan=grow" },
		emphasis: "popular",
		bullets: [
			"Includes $40 / mo compute credit",
			"Daily backups, 14-day point-in-time restore",
			"Per-line spend limits (compute / storage / AI)",
			"BYO AI keys for workflow runs",
			"30-day log retention",
		],
	},
	{
		id: "scale",
		name: "Scale",
		tagline: "High-throughput indexing or multi-app workloads.",
		price: "$349",
		priceUnit: "/ org / mo",
		cta: { label: "Start Scale", href: "/platform?plan=scale" },
		bullets: [
			"Includes $150 / mo compute credit",
			"SOC2 attestation, SSO, 28-day log retention",
			"Priority email support, on-call escalation",
			"Larger compute ladder (XL, 2XL)",
			"Audit log + access controls",
		],
	},
	{
		id: "enterprise",
		name: "Enterprise",
		tagline: "Dedicated boxes, BYOC, custom SLAs.",
		price: "Custom",
		priceUnit: "talk to us",
		cta: { label: "Contact sales", href: "mailto:hi@secondlayer.tools" },
		emphasis: "enterprise",
		bullets: [
			"Dedicated server(s) — single-tenant or BYOC",
			"Negotiated SLA + 24/7 incident response",
			"HIPAA, custom retention policies",
			"Direct DATABASE_URL, custom networking",
			"Quarterly architecture reviews",
		],
	},
];

const COMPUTE_LADDER: Array<{
	name: string;
	specs: string;
	price: string;
	tier: string;
}> = [
	{
		name: "Nano",
		specs: "0.5 vCPU · 512 MB · 5 GB",
		price: "Hobby only",
		tier: "free",
	},
	{
		name: "Micro",
		specs: "0.5 vCPU · 1 GB · 10 GB",
		price: "≈ $10/mo",
		tier: "$0.014/hr",
	},
	{
		name: "Small",
		specs: "1 vCPU · 2 GB · 20 GB",
		price: "≈ $25/mo",
		tier: "$0.035/hr",
	},
	{
		name: "Medium",
		specs: "2 vCPU · 4 GB · 50 GB",
		price: "≈ $60/mo",
		tier: "$0.083/hr",
	},
	{
		name: "Large",
		specs: "4 vCPU · 8 GB · 200 GB",
		price: "≈ $150/mo",
		tier: "$0.21/hr",
	},
	{
		name: "XL",
		specs: "6 vCPU · 16 GB · 500 GB",
		price: "≈ $300/mo",
		tier: "$0.42/hr",
	},
	{
		name: "2XL",
		specs: "8 vCPU · 32 GB · 1 TB",
		price: "≈ $600/mo",
		tier: "$0.84/hr",
	},
];

const INCLUDED_EVERYWHERE = [
	"All five Foundation Datasets",
	"Public APIs, parquet bulk dumps, public status",
	"Subgraphs, Streams, Index, Subscriptions",
	"SDKs (TypeScript, Python, Go), CLI, MCP server",
	"Cursor APIs, idempotent ingest, deterministic replay",
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
						Pay for compute,
						<br />
						not features.
					</h1>
					<p className="www-hero-sub">
						Every plan ships every product. Compute scales independently. The
						Foundation Datasets are free on every tier — including the free one.
					</p>
				</section>

				<section className="www-tiers" aria-label="Pricing tiers">
					{TIERS.map((tier, idx) => (
						<TierCard key={tier.id} tier={tier} index={idx} />
					))}
				</section>

				<section className="www-callout">
					<div className="www-callout-tag">the differentiator</div>
					<h2 className="www-callout-title">
						Soft spend caps. 80% threshold alerts.
						<br />
						No surprise bills.
					</h2>
					<p className="www-callout-body">
						Every paid tier ships with line-item caps for compute, storage, and
						AI calls. We email at 80%, freeze at 100%, and never silently
						overcharge for a runaway loop. This is the one thing every
						Supabase-style customer asks for, and the one thing they don't ship
						— so we did.
					</p>
				</section>

				<section className="www-section">
					<div className="www-section-head">
						<div className="www-section-num">compute</div>
						<h2 className="www-section-title">Resize compute independently.</h2>
						<p className="www-section-sub">
							A small team needing SOC2 shouldn't have to buy 8 vCPU. A
							high-throughput indexer shouldn't have to buy enterprise SSO.
							Compute and plan are decoupled.
						</p>
					</div>
					<ol className="www-ladder">
						{COMPUTE_LADDER.map((step, idx) => (
							<li key={step.name} className="www-ladder-step">
								<div className="www-ladder-rail" aria-hidden="true">
									<span className="www-ladder-bar" data-step={idx} />
								</div>
								<div className="www-ladder-name">{step.name}</div>
								<div className="www-ladder-specs">{step.specs}</div>
								<div className="www-ladder-price">
									<span>{step.price}</span>
									<span className="www-ladder-rate">{step.tier}</span>
								</div>
							</li>
						))}
					</ol>
					<p className="www-ladder-foot">
						Storage overage: $0.10 / GB / month. Egress: metered, soft-capped.
						Hourly billing — resize anytime.
					</p>
				</section>

				<section className="www-section">
					<div className="www-section-head">
						<div className="www-section-num">included</div>
						<h2 className="www-section-title">
							What every plan ships — including Hobby.
						</h2>
						<p className="www-section-sub">
							We don't gate features behind plans. Pricing is about how much
							compute you reserve and how much support you get — not which APIs
							you can call.
						</p>
					</div>
					<ul className="www-included">
						{INCLUDED_EVERYWHERE.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</section>

				<section className="www-cta-bottom">
					<h2 className="www-cta-bottom-title">
						Have a workload outside this list?
						<br />
						We probably already host one like it.
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

			<footer className="www-footer">
				<div className="www-footer-line">
					<span>secondlayer · the data plane for Stacks</span>
					<span>
						<Link href="/public/status">status</Link>
						{" · "}
						<Link href="/docs">docs</Link>
						{" · "}
						<Link href="/">home</Link>
					</span>
				</div>
			</footer>
		</div>
	);
}

function TierCard({ tier, index }: { tier: Tier; index: number }) {
	const emphasisClass = tier.emphasis ? ` www-tier-${tier.emphasis}` : "";
	return (
		<article
			className={`www-tier${emphasisClass}`}
			style={{ animationDelay: `${index * 60}ms` }}
		>
			<header className="www-tier-head">
				<h3 className="www-tier-name">{tier.name}</h3>
				{tier.emphasis === "popular" ? (
					<span className="www-tier-flag">most picked</span>
				) : tier.emphasis === "free" ? (
					<span className="www-tier-flag www-tier-flag-pink">free</span>
				) : null}
			</header>
			<p className="www-tier-tagline">{tier.tagline}</p>
			<div className="www-tier-price">
				<span className="www-tier-amount">{tier.price}</span>
				<span className="www-tier-unit">{tier.priceUnit}</span>
			</div>
			<ul className="www-tier-bullets">
				{tier.bullets.map((b) => (
					<li key={b}>{b}</li>
				))}
			</ul>
			<Link
				href={tier.cta.href}
				className={`www-btn ${
					tier.emphasis === "popular" || tier.emphasis === "free"
						? "www-btn-primary"
						: ""
				} www-tier-cta`}
			>
				{tier.cta.label}
			</Link>
		</article>
	);
}
