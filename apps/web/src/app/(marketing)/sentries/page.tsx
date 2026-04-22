import { BoxBadge } from "@/components/box-badge";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import Link from "next/link";

const toc: TocItem[] = [
	{ label: "What is a sentry", href: "#what" },
	{ label: "How it works", href: "#how" },
	{ label: "Available sentries", href: "#kinds" },
];

export default function SentriesPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Sentries" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">
						Protocol Sentry <BoxBadge>Beta</BoxBadge>
					</h1>
				</header>

				<div className="prose">
					<p>
						Protocol Sentry watches your Stacks contracts in realtime, triages
						anomalies with AI, and pages you before exploits compound. Paste an
						address, pick a webhook, enable a sentry — you&rsquo;re covered in
						under a minute.
					</p>
					<p>
						<strong>Free for subgraph customers during beta.</strong> Paid tiers
						roll out once we&rsquo;ve shipped enough pre-built sentries to cover
						the common protocol risk surface.
					</p>
				</div>

				<div style={{ margin: "32px 0" }}>
					<Link
						href="/sentries"
						className="btn btn-primary"
						style={{ fontSize: 14 }}
					>
						Enable on your dashboard →
					</Link>
				</div>

				<SectionHeading id="what">What is a sentry</SectionHeading>

				<div className="prose">
					<p>
						A sentry is a pre-built monitor for a common on-chain risk. Each one
						watches indexed chain events, AI-triages matches for severity and
						likely cause, and delivers a structured alert to Slack, Discord, or
						any compatible webhook.
					</p>
					<p>
						You don&rsquo;t write any code. Secondlayer authors sentries using
						its internal workflow SDK; you enable them from the dashboard with a
						contract address, a threshold, and a delivery URL.
					</p>
				</div>

				<SectionHeading id="how">How it works</SectionHeading>

				<div className="prose">
					<ol>
						<li>
							<strong>Enable.</strong> From the dashboard, pick a sentry, paste
							your contract address, set a threshold, drop in a Slack webhook.
						</li>
						<li>
							<strong>Watch.</strong> Secondlayer&rsquo;s indexer already
							captures every Stacks block. Sentries run a detection query every
							60 seconds against the shared indexed data — no new infrastructure
							to provision.
						</li>
						<li>
							<strong>Triage.</strong> Matches are summarized by Claude Haiku —
							severity, one-line explanation, likely cause.
						</li>
						<li>
							<strong>Alert.</strong> Structured Slack blocks land in your
							channel of choice within seconds.
						</li>
					</ol>
				</div>

				<SectionHeading id="kinds">Available sentries</SectionHeading>

				<div className="prose">
					<p>
						v1 ships one sentry. More land as we build them — if you have a
						specific monitor you want first, email us at{" "}
						<a href="mailto:hey@secondlayer.tools">hey@secondlayer.tools</a>.
					</p>
				</div>

				<div
					style={{
						border: "1px solid var(--border)",
						borderRadius: 8,
						padding: 20,
						marginTop: 16,
						marginBottom: 12,
					}}
				>
					<div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
						🐋 Large outflow
					</div>
					<div
						style={{
							fontSize: 13,
							color: "var(--fg-muted)",
							marginBottom: 12,
						}}
					>
						Available now
					</div>
					<div style={{ fontSize: 14, lineHeight: 1.5 }}>
						Alert on any STX transfer to or from a watched principal above a
						threshold. Triage classifies it as routine outflow, unusual
						counterparty, or possible drain.
					</div>
				</div>

				<div
					style={{
						border: "1px dashed var(--border)",
						borderRadius: 8,
						padding: 16,
						marginBottom: 8,
						opacity: 0.6,
					}}
				>
					<div style={{ fontWeight: 500, fontSize: 14 }}>
						Permission change — <em>coming soon</em>
					</div>
					<div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 4 }}>
						Admin / governance contract-call detector.
					</div>
				</div>

				<div
					style={{
						border: "1px dashed var(--border)",
						borderRadius: 8,
						padding: 16,
						marginBottom: 8,
						opacity: 0.6,
					}}
				>
					<div style={{ fontWeight: 500, fontSize: 14 }}>
						TVL anomaly — <em>coming soon</em>
					</div>
					<div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 4 }}>
						TVL drops above N% in an M-minute window.
					</div>
				</div>

				<div
					style={{
						border: "1px dashed var(--border)",
						borderRadius: 8,
						padding: 16,
						marginBottom: 8,
						opacity: 0.6,
					}}
				>
					<div style={{ fontWeight: 500, fontSize: 14 }}>
						Oracle drift — <em>coming soon</em>
					</div>
					<div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 4 }}>
						Oracle vs DEX-derived price divergence detector.
					</div>
				</div>
			</main>
		</div>
	);
}
