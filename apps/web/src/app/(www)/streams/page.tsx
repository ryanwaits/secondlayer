import { CodeBlock } from "@/components/code-block";
import { getHighlights } from "@/lib/changelog";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Streams | secondlayer",
	description:
		"The raw event firehose for Stacks — ordered, cursor-paginated, reorg-aware. Consume over SSE, REST, or signed parquet dumps. x402-compatible.",
};

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
    await rollbackAbove(reorg.fork_point_height);
    await saveCheckpoint(cursor);
  },
});`;

const SDK_CARD_CODE = `await streams.events.consume({
  types: ["print"],
  onBatch: (events, _e, { cursor }) =>
    save(events, cursor),
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
					The raw event firehose.
					<br />
					Every event, in order.
				</h1>
				<p className="pp-sub">
					Streams is the immutable, replayable log of everything the chain emits
					— ordered, cursor-paginated, and reorg-aware. Tail the tip over SSE,
					page it over REST, or pull signed parquet dumps. This is the layer
					you'd run a node for.
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
						One firehose, four ways in.
						<br />
						<span className="dim">SSE, REST, bulk dumps, or x402.</span>
					</h2>
					<p>
						Consume live over the SDK, page it over plain REST, backfill cold
						history from signed parquet, or pay per call with x402 — no account
						required.
					</p>
					<Link href="/docs/streams" className="pp-docs-link">
						Read the Streams docs <span className="ar">→</span>
					</Link>
				</div>
				<div className="pp-surfaces">
					{/* SDK — consume loop */}
					<div className="pp-surface">
						<h4>SDK</h4>
						<p>A checkpointed consume loop with reorg handling built in.</p>
						<div className="pp-codeview">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
							</div>
							<CodeBlock code={SDK_CARD_CODE} lang="typescript" />
						</div>
					</div>

					{/* REST — cursor pagination */}
					<div className="pp-surface">
						<h4>REST</h4>
						<p>Idempotent cursor pagination — persist it, resume exactly.</p>
						<div className="pp-vis">
							<div className="pp-req">
								<div>
									<span className="verb">GET</span> /v1/streams/events
								</div>
								<div>&nbsp;&nbsp;?from_cursor=8249712:0</div>
								<div className="res">
									<span className="status">200</span> &#123;{" "}
									<span className="key">events</span>: [ … ],
								</div>
								<div
									className="res"
									style={{ marginTop: 0, borderTop: "none" }}
								>
									&nbsp;&nbsp;<span className="key">next_cursor</span>:
									"8249713:6" &#125;
								</div>
							</div>
						</div>
					</div>

					{/* Bulk — signed parquet dumps */}
					<div className="pp-surface">
						<h4>Bulk</h4>
						<p>Backfill cold history from signed parquet, then tail live.</p>
						<div className="pp-vis">
							<div className="pp-cli">
								<div>
									<span className="mut">// replay genesis → tip, no gap</span>
								</div>
								<div>
									<span className="pp-k">await</span> streams.events
								</div>
								<div>
									&nbsp;&nbsp;.<span className="pp-fn">replay</span>(&#123;
									from: <span className="pp-s">"genesis"</span> &#125;);
								</div>
								<div className="mut">→ signed parquet dumps</div>
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
								<div
									className="res"
									style={{ borderTop: "none", marginTop: 4 }}
								>
									<span style={{ color: "var(--yellow, #eab308)" }}>402</span>{" "}
									Payment Required
								</div>
								<div
									className="res"
									style={{ marginTop: 0, borderTop: "none" }}
								>
									→ x402 · pay <span className="key">0.001 STX</span>
								</div>
								<div
									className="res"
									style={{ marginTop: 0, borderTop: "none" }}
								>
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
						Stop running a node.
						<br />
						Tap the firehose.
					</h2>
					<p>
						Every event the chain emits, ordered and replayable — over SSE,
						REST, or signed parquet.
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
