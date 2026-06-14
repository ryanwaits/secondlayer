import { CodeBlock } from "@/components/code-block";
import { getHighlights } from "@/lib/changelog";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "Streams | secondlayer",
	description:
		"The raw event firehose for Stacks — ordered, cursor-paginated, reorg-aware. Consume over SSE, REST, or signed bulk dumps. x402-compatible.",
	image: "/og/streams.png",
	path: "/streams",
});

const CONSUME_CODE = `import { createStreamsClient } from "@secondlayer/sdk";

const streams = createStreamsClient({ apiKey: process.env.SL_API_KEY });

// Every event the chain emits, in order — resume from any
// cursor, reorg-aware, no node to run.
await streams.events.consume({
  fromCursor: lastCheckpoint,
  types: ["print"],
  contractId: "SP2QEZ…BNS-V2",
  batchSize: 500,
  onBatch: async (events, _envelope, { cursor }) => {
    for (const e of events) await handle(e);
    await saveCheckpoint(cursor);
  },
  onReorg: async (reorg, { cursor }) => {
    await rollbackFrom(reorg.fork_point_height); // inclusive of the fork block
    await saveCheckpoint(cursor);
  },
});`;

export default function StreamsPage() {
	const highlights = getHighlights("streams");
	return (
		<main className="pp">
			<header className="pp-hero">
				<Link href="/docs/x402" className="pp-pill">
					<span className="dot" /> x402-compatible — accountless pay-per-call{" "}
					<span className="arr">→</span>
				</Link>
				<h1>
					Every raw event.
					<br />
					No node required.
				</h1>
				<p className="pp-sub">
					Streams is the immutable, replayable log of everything the chain emits
					— ordered, cursor-paginated, and reorg-aware. Tail the tip over SSE,
					page it over REST, or pull signed bulk dumps. This is what you'd run a
					node for — and what Index itself is built on: our decoder is a Streams
					consumer.
				</p>
				<div className="pp-ctas">
					<Link href="/docs/streams" className="pp-btn pp-btn-ink">
						Start streaming
					</Link>
					<Link href="/docs/streams" className="pp-btn pp-btn-ghost">
						Read the docs →
					</Link>
				</div>
			</header>

			{/* PRODUCT WINDOW DEMO: consume loop + live cursor */}
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
								<div className="pp-title">firehose.ts</div>
							</div>
							<div className="pp-editor">
								<CodeBlock code={CONSUME_CODE} lang="typescript" />
							</div>
						</div>

						<div className="pp-window pp-win-sm">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
								<div className="pp-title">curl — streams</div>
							</div>
							<div className="pp-term">
								<div>
									<span className="pfx">$</span> curl
									…/v1/streams/events?from_cursor=8249712:0
								</div>
								<div>
									&#123; <span className="mut">"events"</span>: [ …500 ],
								</div>
								<div>
									&nbsp;&nbsp;<span className="mut">"next_cursor"</span>:{" "}
									<span className="pp-s">"8249713:6"</span>,
								</div>
								<div>
									&nbsp;&nbsp;<span className="mut">"tip"</span>: &#123;
									"block_height": <span className="pp-s">8249743</span> &#125;
									&#125;
								</div>
								<div>
									<span className="pfx">$</span> <span className="cur" />
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* SURFACES — distinct treatment per surface */}
			<section className="pp-section pp-wrap">
				<div className="pp-section-head">
					<h2>
						One firehose, three ways in.
						<br />
						<span className="dim">Stream it, pull it, or pay per call.</span>
					</h2>
					<p>
						Tail the tip over SSE, backfill cold history from signed dumps, or
						let an agent pay per call with x402, no account required.
					</p>
					<Link href="/docs/streams" className="pp-docs-link">
						Read the Streams docs <span className="ar">→</span>
					</Link>
				</div>
				<div className="pp-surfaces three">
					{/* Live (SSE) — events landing in real time */}
					<div className="pp-surface">
						<h4>Live (SSE)</h4>
						<p>
							Tail the tip over a single connection — events arrive as they
							land.
						</p>
						<div className="pp-vis">
							<div className="pp-cli">
								<div>
									<span className="ok">●</span> live ·{" "}
									<span className="mut">cursor 8,249,714:0</span>
								</div>
								<div>
									#8,249,712 <span className="mut">· 11 events · +2.4s</span>
								</div>
								<div>
									#8,249,713 <span className="mut">· 6 events · +4.9s</span>
								</div>
								<div>
									#8,249,714 <span className="mut">· 12 events · +7.3s</span>
								</div>
							</div>
						</div>
					</div>

					{/* Bulk — signed dumps manifest */}
					<div className="pp-surface">
						<h4>Bulk</h4>
						<p>
							Backfill cold history from signed dumps, then tail live with no
							gap.
						</p>
						<div className="pp-vis">
							<div className="pp-cli">
								<div className="mut">signed bulk dumps</div>
								<div>
									<span className="ok">✓</span> 0008240000-0008249999.parquet
								</div>
								<div className="mut">&nbsp;&nbsp;&nbsp;102 MB · 1.33M rows</div>
								<div>
									<span className="ok">✓</span> 0008230000-0008239999.parquet
								</div>
								<div className="mut">&nbsp;&nbsp;&nbsp;98 MB · 1.29M rows</div>
							</div>
						</div>
					</div>

					{/* x402 — accountless pay-per-call */}
					<div className="pp-surface">
						<h4>x402</h4>
						<p>No account, no key — an agent pays per call over HTTP 402.</p>
						<div className="pp-vis">
							<div className="pp-req">
								<div>
									<span className="verb">GET</span> /v1/streams/events
								</div>
								<div>
									<span style={{ color: "var(--yellow, #eab308)" }}>402</span>{" "}
									Payment Required
								</div>
								<div>
									→ x402 · pay <span className="key">0.001 STX</span>
								</div>
								<div>
									<span className="status">200</span> &#123;{" "}
									<span className="key">events</span>: [ … ] &#125;
								</div>
							</div>
						</div>
					</div>
				</div>
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
						Point your cursor at genesis.
						<br />
						Press play.
					</h2>
					<p>
						Every event the chain emits, ordered and replayable — over SSE,
						REST, or signed dumps.
					</p>
					<div className="pp-ctas">
						<Link href="/docs/streams" className="pp-btn pp-btn-ink">
							Start streaming
						</Link>
						<Link href="/docs/x402" className="pp-btn pp-btn-ghost">
							x402 pay-per-call →
						</Link>
					</div>
				</div>
			</section>
		</main>
	);
}
