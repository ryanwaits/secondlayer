import { CodeBlock } from "@/components/code-block";
import { Notation } from "@/components/notation";
import { CodeWalkthrough } from "@/components/product/code-walkthrough";
import { getHighlights } from "@/lib/changelog";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "Stacks Subgraphs | secondlayer",
	description:
		"You shape it, we run it. Pick events and write handlers in one TypeScript file — get typed Postgres tables, a public REST API, and genesis backfill, hosted or bring your own database.",
	image: "/og/subgraphs.png",
	path: "/subgraphs",
});

const SUBGRAPH_CODE = `export default defineSubgraph({
  name: "stx-transfers",
  sources: {
    transfer: { type: "stx_transfer" },
  },
  schema: {
    transfers: {
      columns: {
        sender: { type: "principal", indexed: true },
        recipient: { type: "principal", indexed: true },
        amount: { type: "uint" },
      },
    },
  },
  handlers: {
    transfer: (event, ctx) => {
      ctx.insert("transfers", {
        sender: event.sender,
        recipient: event.recipient,
        amount: event.amount,
      });
    },
  },
});`;

const WALK_STEPS = [
	{
		label: "Sources",
		desc: "Name the on-chain events your subgraph listens for — by type, contract, or trait.",
		from: 3,
		to: 5,
	},
	{
		label: "Schema",
		desc: "Declare the Postgres tables and columns you want. principal, uint, text, jsonb, and more.",
		from: 6,
		to: 14,
	},
	{
		label: "Handlers",
		desc: "Turn each event into rows with the write context — insert, upsert, findOne.",
		from: 15,
		to: 23,
	},
];

export default function SubgraphsPage() {
	const highlights = getHighlights("subgraphs");
	return (
		<main className="pp">
			<header className="pp-hero">
				<Link href="/subgraphs/explore" className="pp-pill">
					<span className="dot" /> Explore subgraphs is live{" "}
					<span className="arr">→</span>
				</Link>
				<h1>
					You shape it.
					<br />
					We run it.
				</h1>
				<p className="pp-sub">
					Pick your events, write handlers, deploy — one TypeScript file. Out
					comes typed Postgres tables shaped for your app, a public REST API
					(REST, not GraphQL), and a page on Explore: backfilled from genesis,
					reorg-safe, and never silently dropped on a schema change. We host it,
					or bring your own database.
				</p>
				<div className="pp-ctas">
					<Link href="/docs/subgraphs" className="pp-btn pp-btn-ink">
						Deploy a subgraph
					</Link>
					<Link href="/docs/subgraphs" className="pp-btn pp-btn-ghost">
						Read the docs →
					</Link>
				</div>
			</header>

			{/* PRODUCT WINDOW DEMO: the real console detail view */}
			<section className="pp-wrap">
				<div className="pp-stage">
					<div className="pp-stage-inner">
						<div className="pp-window pp-win-lg">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
								<div className="pp-title">secondlayer · Subgraphs</div>
							</div>
							<div className="pp-body">
								<div className="pp-console">
									<div className="pp-sg-hdr">
										<span className="pp-sg-dot" />
										<span className="pp-sg-name">stx-transfers</span>
										<span className="pp-sg-ver">v3</span>
										<span className="pp-sg-sp" />
										<span className="pp-sg-btn">Subscriptions</span>
									</div>
									<div className="pp-ep">
										<span className="pp-ep-m">GET</span>
										<span className="pp-ep-url">
											api.secondlayer.tools/v1/subgraphs/stx-transfers/
											<span className="hl">&lt;table&gt;</span>
										</span>
										<span className="pp-ep-link">API docs →</span>
									</div>
									<div className="pp-cards">
										<div className="pp-mcard">
											<span className="ml">Uptime</span>
											<span className="mv">
												99.9<span className="u">%</span>
											</span>
										</div>
										<div className="pp-mcard">
											<span className="ml">Block sync</span>
											<span className="mv" style={{ fontSize: "1.1rem" }}>
												#8,249,712
											</span>
										</div>
										<div className="pp-mcard">
											<span className="ml">Rows indexed</span>
											<span className="mv">
												2.14<span className="u">M</span>
											</span>
										</div>
										<div className="pp-mcard">
											<span className="ml">Latency</span>
											<span className="mv">
												1.2<span className="u">s</span>
											</span>
										</div>
									</div>
									<div className="pp-tcard">
										<div className="pp-tcard-head">
											<span className="pp-tcard-name">transfers</span>
											<span className="pp-tcard-stats">
												<span>
													<strong>2.1M</strong> rows
												</span>
												<span>
													<strong>6</strong> cols
												</span>
											</span>
										</div>
										<div className="pp-chips">
											<span className="pp-chip idx">sender</span>
											<span className="pp-chip idx">recipient</span>
											<span className="pp-chip">amount</span>
											<span className="pp-chip">memo</span>
											<span className="pp-chip sys">_block_height</span>
											<span className="pp-chip sys">_tx_id</span>
										</div>
									</div>
								</div>
							</div>
						</div>

						<div className="pp-window pp-win-sm">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
								<div className="pp-title">sl — subgraphs</div>
							</div>
							<div className="pp-term">
								<div>
									<span className="pfx">$</span> sl subgraphs deploy
									stx-transfers.ts --visibility public
								</div>
								<div>
									<span className="ok">✓</span> Subgraph{" "}
									<span className="pp-s">"stx-transfers"</span> created → v1
								</div>
								<div>
									<span className="inf">ℹ</span>&nbsp;&nbsp;
									<span className="mut">
										Read: …/v1/subgraphs/stx-transfers/transfers
									</span>
								</div>
								<div>
									<span className="inf">ℹ</span>&nbsp;&nbsp;
									<span className="mut">
										Share: …/v1/subgraphs/stx-transfers (public)
									</span>
								</div>
								<div>
									<span className="pfx">$</span> <span className="cur" />
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* THREE PARTS: source / schema / handler — real code views */}
			<section className="pp-section pp-wrap">
				<div className="pp-section-head">
					<h2>
						Three parts, one file.
						<br />
						<span className="dim">Sources, schema, handlers.</span>
					</h2>
					<p>
						The whole subgraph is one TypeScript file. Writes batch and flush
						atomically per block — on compatible redeploys it reindexes for you
						(breaking schema changes get a migration plan, never a silent drop).
					</p>
					<Link href="/docs/subgraphs" className="pp-docs-link">
						Read the Subgraphs docs <span className="ar">→</span>
					</Link>
				</div>
				<CodeWalkthrough steps={WALK_STEPS}>
					<div className="pp-bar">
						<div className="pp-dots">
							<i />
							<i />
							<i />
						</div>
						<div className="pp-title">stx-transfers.ts</div>
					</div>
					<div className="pp-editor">
						<CodeBlock code={SUBGRAPH_CODE} lang="typescript" />
					</div>
				</CodeWalkthrough>
			</section>

			{/* RECENT HIGHLIGHTS — derived from /docs/changelog */}
			<section className="pp-band">
				<div className="pp-wrap pp-highlights">
					<span className="pp-hl-label">Recent highlights</span>
					<div className="pp-posts">
						{highlights.map((h) => (
							<Link key={h.slug} href={h.href} className="pp-post">
								<h4>{h.title}</h4>
								<p>{h.summary}</p>
								<span className="meta">
									{h.productLabel} · {h.date}
								</span>
							</Link>
						))}
						<Link href="/docs/changelog" className="pp-more">
							View the changelog →
						</Link>
					</div>
				</div>
			</section>

			<section className="pp-final">
				<div className="pp-wrap">
					<h2>
						Your schema. Our uptime.
						<br />
						Your data, never silently dropped.
					</h2>
					<p>
						One file, one deploy.{" "}
						<Notation
							type="underline"
							color="var(--accent)"
							strokeWidth={2}
							padding={2}
						>
							Hosted or BYO database
						</Notation>
						, full genesis backfill on paid plans.
					</p>
					<div className="pp-ctas">
						<Link href="/docs/subgraphs" className="pp-btn pp-btn-ink">
							Deploy a subgraph
						</Link>
						<Link href="/subgraphs/explore" className="pp-btn pp-btn-ghost">
							Explore live subgraphs →
						</Link>
					</div>
				</div>
			</section>
		</main>
	);
}
