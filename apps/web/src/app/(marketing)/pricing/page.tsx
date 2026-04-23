import { BoxBadge } from "@/components/box-badge";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import { TIER_META } from "@/lib/billing";
import Link from "next/link";

export const metadata = {
	title: "Pricing · Secondlayer",
	description:
		"Pay for compute, not features. Hobby (free) through Scale, plus self-hosted OSS.",
};

const toc: TocItem[] = [
	{ label: "Tiers", href: "#tiers" },
	{ label: "Included on every tier", href: "#included" },
	{ label: "Self-host", href: "#oss" },
	{ label: "FAQ", href: "#faq" },
];

const TIERS = [
	TIER_META.hobby,
	TIER_META.launch,
	TIER_META.grow,
	TIER_META.scale,
];

const TIER_CTAS: Record<string, { label: string; href: string }> = {
	hobby: { label: "Start free", href: "/login" },
	launch: { label: "Start Launch", href: "/login" },
	grow: { label: "Start Grow", href: "/login" },
	scale: { label: "Start Scale", href: "/login" },
};

export default function PricingPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Pricing" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">
						Pricing <BoxBadge>Beta</BoxBadge>
					</h1>
				</header>

				<div className="prose">
					<p>
						<strong>Pay for compute, not features.</strong> Every tier gets the
						full product — subgraphs, sentries, workflows SDK, CLI + SDK + MCP
						access. Tiers differ in resource limits and AI eval caps, not
						what&apos;s unlocked.
					</p>
					<p>
						Hobby is free forever (auto-pauses after 7 days idle, wakes on any
						request). Paid tiers start at $149/mo. Enterprise is custom — talk
						to us if you need dedicated support, SSO, or non-standard SLA.
					</p>
				</div>

				<SectionHeading id="tiers">Tiers</SectionHeading>

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
						gap: 16,
						margin: "24px 0 32px",
					}}
				>
					{TIERS.map((t) => {
						const cta = TIER_CTAS[t.tier];
						const isLaunch = t.tier === "launch";
						return (
							<div
								key={t.tier}
								style={{
									border: `1px solid ${isLaunch ? "var(--text-main, #111)" : "var(--border, #ddd)"}`,
									borderRadius: 8,
									padding: 20,
									background: isLaunch
										? "var(--surface, #fafafa)"
										: "transparent",
								}}
							>
								<div
									style={{
										fontSize: 12,
										textTransform: "uppercase",
										letterSpacing: "0.06em",
										color: "var(--text-muted, #666)",
										marginBottom: 8,
									}}
								>
									{t.name}
								</div>
								<div
									style={{
										fontSize: 28,
										fontWeight: 500,
										marginBottom: 4,
										fontFamily: "var(--font-heading-stack, inherit)",
										letterSpacing: "-0.02em",
									}}
								>
									{t.priceUsd === 0 ? "Free" : `$${t.priceUsd}`}
									{t.priceUsd > 0 && (
										<span
											style={{
												fontSize: 13,
												color: "var(--text-muted, #666)",
												fontWeight: 400,
											}}
										>
											{" "}
											/ mo
										</span>
									)}
								</div>
								<div
									style={{
										fontSize: 13,
										color: "var(--text-muted, #666)",
										marginBottom: 16,
									}}
								>
									{t.tagline}
								</div>
								<ul
									style={{
										listStyle: "none",
										padding: 0,
										margin: "0 0 20px",
										fontSize: 13,
										lineHeight: 1.6,
									}}
								>
									{t.features.map((f) => (
										<li key={f} style={{ marginBottom: 4 }}>
											· {f}
										</li>
									))}
								</ul>
								<Link
									href={cta.href}
									style={{
										display: "inline-block",
										padding: "8px 16px",
										fontSize: 13,
										fontWeight: 500,
										color: isLaunch
											? "var(--bg, #fff)"
											: "var(--text-main, #111)",
										background: isLaunch
											? "var(--text-main, #111)"
											: "transparent",
										border: "1px solid var(--text-main, #111)",
										borderRadius: 6,
										textDecoration: "none",
									}}
								>
									{cta.label}
								</Link>
							</div>
						);
					})}
				</div>

				<div
					style={{
						border: "1px dashed var(--border, #ddd)",
						borderRadius: 8,
						padding: 20,
						marginBottom: 32,
					}}
				>
					<div
						style={{
							fontSize: 12,
							textTransform: "uppercase",
							letterSpacing: "0.06em",
							color: "var(--text-muted, #666)",
							marginBottom: 6,
						}}
					>
						Enterprise
					</div>
					<div
						style={{
							fontSize: 14,
							marginBottom: 12,
						}}
					>
						Custom compute + storage, dedicated support engineer, SSO, SOC2
						assistance, non-standard SLA. Starting around $2.5k/mo.
					</div>
					<a
						href="mailto:hey@secondlayer.tools?subject=Enterprise%20inquiry"
						style={{
							fontSize: 13,
							color: "var(--text-main, #111)",
							fontWeight: 500,
						}}
					>
						Talk to us →
					</a>
				</div>

				<SectionHeading id="included">Included on every tier</SectionHeading>

				<div className="prose">
					<p>No feature gating. Every tier gets:</p>
					<ul>
						<li>
							<strong>Subgraphs</strong> — unlimited custom indexers, full SQL +
							REST access.
						</li>
						<li>
							<strong>Sentries</strong> — unlimited monitoring setups. AI triage
							per alert, Slack-compatible delivery. Usage counts against the
							tier&apos;s AI eval budget.
						</li>
						<li>
							<strong>Workflows SDK</strong> — durable step primitives
							(step.run, step.sleep, step.invoke). Ship your own automation.
						</li>
						<li>
							<strong>Full interface suite</strong> — CLI, SDK, MCP server. Same
							auth, same operations, same patterns.
						</li>
						<li>
							<strong>Open-source everything</strong> — self-host if you prefer.
							Hosted users get auto-updates, managed backups, tenant isolation.
						</li>
					</ul>
				</div>

				<SectionHeading id="oss">Self-host</SectionHeading>

				<div className="prose">
					<p>
						Prefer to run it yourself? The entire stack is MIT-licensed. One
						command gets you indexer + API + subgraph processor on your own
						hardware:
					</p>
				</div>

				<pre
					style={{
						background: "var(--code-bg, #f5f5f5)",
						padding: 14,
						borderRadius: 6,
						fontSize: 13,
						margin: "12px 0 20px",
						overflow: "auto",
					}}
				>
					<code>
						git clone https://github.com/ryanwaits/secondlayer{"\n"}
						cd secondlayer/docker/oss{"\n"}
						docker compose up
					</code>
				</pre>

				<div className="prose">
					<p>
						Self-hosters run their own Stacks node or point at the Hiro API. No
						Secondlayer account or key required. See the{" "}
						<a
							href="https://github.com/ryanwaits/secondlayer/blob/main/docker/oss/README.md"
							style={{ color: "var(--text-main, #111)", fontWeight: 500 }}
						>
							OSS deployment guide
						</a>{" "}
						for production setup (Caddy, backups, TLS).
					</p>
					<p>
						<em>
							Economics: Hetzner dedicated is ~$30-130/mo for specs that cost
							$500+/mo on AWS. We undercut what it costs you to self-host on the
							big clouds. Run OSS if you have the Stacks-node infrastructure in
							place — use hosted for everything else.
						</em>
					</p>
				</div>

				<SectionHeading id="faq">FAQ</SectionHeading>

				<div className="prose">
					<p>
						<strong>Do I need a credit card to start?</strong>
						<br />
						No. Hobby signup requires only email. Card capture happens at
						upgrade.
					</p>
					<p>
						<strong>Can I upgrade / downgrade anytime?</strong>
						<br />
						Yes. Resize between any tier from the dashboard&apos;s instance
						page. Takes ~30s while containers recreate. Data is preserved. Paid
						tiers prorate.
					</p>
					<p>
						<strong>What happens if I hit the AI eval cap?</strong>
						<br />
						New sentry alerts / workflow AI steps degrade to their no-AI
						fallback path — the alert still fires, just without AI triage. Paid
						tiers can also opt into spend caps that freeze the tenant if the
						monthly projected spend exceeds your cap.
					</p>
					<p>
						<strong>What happens on Hobby when nothing uses it?</strong>
						<br />
						After 7 days with no API activity, your Hobby tenant auto-pauses
						(containers stop, storage preserved). The next request auto-resumes
						it in ~20s.
					</p>
					<p>
						<strong>Storage overage?</strong>
						<br />
						Paid tiers bill $2/GB/mo over the included allowance. Hobby has a
						hard 5 GB cap — no overage billing.
					</p>
					<p>
						<strong>What counts as an AI eval?</strong>
						<br />
						Each sentry alert triage is 1 eval. Workflow AI steps (generateText
						/ generateObject) are 1 eval each. Reads and queries don&apos;t
						count.
					</p>
				</div>
			</main>
		</div>
	);
}
