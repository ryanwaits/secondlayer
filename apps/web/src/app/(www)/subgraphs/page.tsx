import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Stacks Subgraphs | secondlayer",
	description:
		"Your own indexer, minus the node. Write handlers in one TypeScript file, get typed Postgres tables shaped exactly for your app.",
};

const HIGHLIGHTS = [
	{
		title: "Explore is live",
		body: (
			<>
				Every public subgraph now gets a live, anon-readable page at{" "}
				<code>/subgraphs/explore</code> — fork any one to scaffold your own.
			</>
		),
		meta: "Product · Jun 9, 2026",
	},
	{
		title: "Safe BYO deploys",
		body: "Breaking-change deploys return a migration plan before any destructive rebuild. Nothing drops without your say-so.",
		meta: "Changelog · Jun 6, 2026",
	},
	{
		title: "Generated typed clients",
		body: (
			<>
				<code>sl subgraphs client</code> emits table types and autocompletion
				shaped to your schema. Query with full inference.
			</>
		),
		meta: "Product · May 20, 2026",
	},
];

export default function SubgraphsPage() {
	return (
		<main className="pp">
			<header className="pp-hero">
				<Link href="/subgraphs/explore" className="pp-pill">
					<span className="dot" /> Explore subgraphs is live{" "}
					<span className="arr">→</span>
				</Link>
				<h1>
					Your own indexer.
					<br />
					Minus the node.
				</h1>
				<p className="pp-sub">
					One TypeScript file: pick your events, write handlers, deploy. You get
					typed Postgres tables shaped for your app, a public read API, and a
					page on Explore. No node, no backfill scripts.
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

			{/* THREE PARTS: source / schema / handler */}
			<section className="pp-section pp-wrap">
				<div className="pp-section-head">
					<h2>
						Three parts, one file.
						<br />
						<span className="dim">Sources, schema, handlers.</span>
					</h2>
					<p>
						The whole subgraph is one TypeScript file. Writes batch and flush
						atomically per block — redeploy and it reindexes for you.
					</p>
					<Link href="/docs/subgraphs" className="pp-docs-link">
						Read the Subgraphs docs <span className="ar">→</span>
					</Link>
				</div>
				<div className="pp-surfaces three">
					<div className="pp-surface">
						<h4>Sources</h4>
						<p>Name the on-chain events your subgraph listens for.</p>
						<Link href="/docs/subgraphs" className="pp-go">
							by type, contract, or trait →
						</Link>
						<div className="pp-mini">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
							</div>
							<div className="pp-mini-body">
								<div>sources: &#123;</div>
								<div>
									&nbsp;&nbsp;<span className="pp-fn">transfer</span>: &#123;
								</div>
								<div>
									&nbsp;&nbsp;&nbsp;&nbsp;type:{" "}
									<span className="pp-s">"stx_transfer"</span>
								</div>
								<div>&nbsp;&nbsp;&#125;,</div>
								<div>&#125;,</div>
							</div>
						</div>
					</div>
					<div className="pp-surface">
						<h4>Schema</h4>
						<p>Declare the Postgres tables and columns you want.</p>
						<Link href="/docs/subgraphs" className="pp-go">
							principal · uint · text · jsonb →
						</Link>
						<div className="pp-mini">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
							</div>
							<div className="pp-mini-body">
								<div>schema: &#123;</div>
								<div>
									&nbsp;&nbsp;<span className="pp-fn">transfers</span>: &#123;
								</div>
								<div>&nbsp;&nbsp;&nbsp;&nbsp;columns: &#123;</div>
								<div>
									&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;sender: &#123; type:{" "}
									<span className="pp-s">"principal"</span>,
								</div>
								<div>
									&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;indexed:{" "}
									<span className="pp-k">true</span> &#125;,
								</div>
								<div>
									&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;amount: &#123; type:{" "}
									<span className="pp-s">"uint"</span> &#125;,
								</div>
							</div>
						</div>
					</div>
					<div className="pp-surface">
						<h4>Handlers</h4>
						<p>Turn each event into rows with the write context.</p>
						<Link href="/docs/subgraphs" className="pp-go">
							ctx.insert · upsert · findOne →
						</Link>
						<div className="pp-mini">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
							</div>
							<div className="pp-mini-body">
								<div>
									<span className="pp-fn">transfer</span>: (event, ctx) =&gt;
									&#123;
								</div>
								<div>
									&nbsp;&nbsp;ctx.<span className="pp-fn">insert</span>(
									<span className="pp-s">"transfers"</span>, &#123;
								</div>
								<div>&nbsp;&nbsp;&nbsp;&nbsp;sender: event.sender,</div>
								<div>&nbsp;&nbsp;&nbsp;&nbsp;recipient: event.recipient,</div>
								<div>&nbsp;&nbsp;&nbsp;&nbsp;amount: event.amount,</div>
								<div>&nbsp;&nbsp;&#125;);</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* RECENT HIGHLIGHTS */}
			<section className="pp-band">
				<div className="pp-wrap pp-highlights">
					<span className="pp-hl-label">Recent highlights</span>
					<div className="pp-posts">
						{HIGHLIGHTS.map((h) => (
							<Link key={h.title} href="/docs/changelog" className="pp-post">
								<h4>{h.title}</h4>
								<p>{h.body}</p>
								<span className="meta">{h.meta}</span>
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
						Define the tables.
						<br />
						We run the indexer.
					</h2>
					<p>
						One file, one deploy. <span className="pp-marker">Free to try</span>
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
