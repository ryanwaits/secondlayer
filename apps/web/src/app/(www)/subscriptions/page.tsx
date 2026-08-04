import { CodeBlock } from "@/components/code-block";
import { getHighlights } from "@/lib/changelog";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "Subscriptions | secondlayer",
	description:
		"Signed webhooks for matched subgraph rows or raw chain events — retried, replayable, and rolled back on a reorg. Hosted, or self-hosted on your own hardware.",
	image: "/og/subscriptions.png",
	path: "/subscriptions",
});

const RECEIVER_CODE = `import { verifyWebhookSignature, decodeChainWebhook } from "@secondlayer/sdk";

// Raw body first — the signature covers bytes, not parsed JSON.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers, secret))
    return new Response("bad signature", { status: 401 });

  const delivery = decodeChainWebhook(raw);

  if ("trigger" in delivery.data) {
    // Discriminated on data.trigger — typed from here down.
    switch (delivery.data.trigger) {
      case "sbtc_deposit": await credit(delivery.data.event); break;
      case "ft_transfer": await ledger(delivery.data.event.data); break;
    }
  } else {
    // A fork names its own casualties — undo them, then move on.
    await undo(delivery.data.orphaned, delivery.data.fork_point_height);
  }

  return new Response("ok");
}`;

const TRIGGERS_CODE = `import { trigger } from "@secondlayer/sdk";

await sl.subscriptions.create({
  name: "amm-swaps",
  url: "https://my-app.com/webhook",
  triggers: [
    trigger.contractCall({ contractId: "SP….amm", functionName: "swap-*" }),
    trigger.ftTransfer({ trait: "sip-010", minAmount: "1000000" }),
  ],
});`;

const REPLAY_CODE = `const { replayId, enqueuedCount } = await sl.subscriptions.replay(id, {
  fromBlock: 8000000,
  toBlock: 8050000,
});`;

const SELF_HOST_CODE = `git clone https://github.com/ryanwaits/secondlayer.git
cd secondlayer/docker/oss && cp .env.example .env

docker compose up -d postgres migrate api indexer subgraph-processor`;

/** Delivery formats — same \`data\` value, different wrapper per runtime. */
const FORMATS: { name: string; shape: string; note?: string }[] = [
	{
		name: "standard-webhooks",
		shape: "{ type, timestamp, data }",
		note: "default · HMAC",
	},
	{ name: "raw", shape: "the body is data — no wrapper" },
	{
		name: "cloudevents",
		shape: "{ specversion, type, source, id, time, data }",
	},
	{ name: "inngest", shape: "[{ name, data, id, ts, v }]", note: "drop-in" },
	{
		name: "trigger",
		shape: "{ payload: data, options: { idempotencyKey } }",
		note: "drop-in",
	},
	{
		name: "cloudflare",
		shape: "{ params: { …data, _type, _outboxId } }",
		note: "drop-in",
	},
];

/** The 17 trigger factories; `on` marks the ones worth reading first. */
const TRIGGERS: { name: string; lead?: boolean }[] = [
	{ name: "contractCall", lead: true },
	{ name: "contractDeploy" },
	{ name: "ftTransfer", lead: true },
	{ name: "ftMint" },
	{ name: "ftBurn" },
	{ name: "nftTransfer" },
	{ name: "nftMint" },
	{ name: "nftBurn" },
	{ name: "stxTransfer" },
	{ name: "stxMint" },
	{ name: "stxBurn" },
	{ name: "stxLock" },
	{ name: "printEvent", lead: true },
	{ name: "sbtcDeposit", lead: true },
	{ name: "sbtcWithdrawalCreate" },
	{ name: "sbtcWithdrawalAccept" },
	{ name: "sbtcWithdrawalSweptConfirmed" },
];

export default function SubscriptionsPage() {
	const highlights = getHighlights("subscriptions");

	return (
		<main className="pp">
			<header className="pp-hero">
				<Link href="/docs/migrate-chainhook" className="pp-pill">
					<span className="dot" /> Coming from Chainhook v2?
					Predicate-to-trigger mapping <span className="arr">→</span>
				</Link>
				<h1>
					Only what matches.
					<br />
					On our infra or yours.
				</h1>
				<p className="pp-sub">
					A subscription POSTs matching subgraph rows — or raw chain events with
					no subgraph at all — straight to your endpoint. Signed, retried,
					rolled back on a fork. Run it hosted, or bring the whole stack up on
					your own hardware.
				</p>
				<div className="pp-ctas">
					<Link href="/docs/subscriptions" className="pp-btn pp-btn-ink">
						Create a subscription
					</Link>
					<Link href="/docs/self-host" className="pp-btn pp-btn-ghost">
						Self-host it →
					</Link>
				</div>
			</header>

			{/* PRODUCT WINDOW DEMO: receiver + delivery log with a reorg in it */}
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
								<div className="pp-title">webhook.ts</div>
							</div>
							<div className="pp-editor">
								<CodeBlock code={RECEIVER_CODE} lang="typescript" />
							</div>
						</div>

						<div className="pp-window pp-win-sm">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
								<div className="pp-title">sl subscriptions logs sbtc-hook</div>
							</div>
							<div className="pp-term">
								<div>
									<span className="ok">200</span> chain.sbtc_deposit.apply{" "}
									<span className="mut">· 142ms</span>
								</div>
								<div>
									<span className="ok">200</span> chain.ft_transfer.apply{" "}
									<span className="mut">· 96ms</span>
								</div>
								<div>
									<span className="inf">↺</span> chain.reorg.rollback{" "}
									<span className="mut">· fork at #8,249,711</span>
								</div>
								<div>
									<span className="mut">&nbsp;&nbsp;&nbsp;orphaned: 3</span>
								</div>
								<div>
									<span className="ok">200</span>{" "}
									<span className="mut">rollback acknowledged</span>
								</div>
								<div>
									<span className="pfx">$</span> <span className="cur" />
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* TWO KINDS — with a subgraph, or without one */}
			<section className="pp-section pp-wrap">
				<div className="pp-section-head">
					<h2>
						Two kinds of subscription.
						<br />
						<span className="dim">One with a subgraph. One without.</span>
					</h2>
					<p>
						Subscribe to the rows your own handler writes, or skip the subgraph
						entirely and match raw chain events as they land. Same delivery
						guarantees either way.
					</p>
				</div>
				<div className="pp-surfaces two">
					<div className="pp-surface">
						<h4>Subgraph — every change to a table you own</h4>
						<p>
							Fires on the row lifecycle your handler drives: created, updated,
							deleted. The payload type is{" "}
							<code>&lt;subgraph&gt;.&lt;table&gt;.&lt;verb&gt;</code>, so one
							receiver can route the whole table. Backfills from history and
							replays on demand.
						</p>
						<div className="pp-vis">
							<div className="pp-cli">
								<div>
									<span className="pfx">$</span> sl subscriptions create
									sbtc-webhook \
								</div>
								<div className="mut">
									&nbsp;&nbsp;&nbsp;--subgraph sbtc-flows \
								</div>
								<div className="mut">&nbsp;&nbsp;&nbsp;--table transfers \</div>
								<div className="mut">
									&nbsp;&nbsp;&nbsp;--url https://your-app.com/webhooks
								</div>
								<div>
									<span className="ok">✓</span> sbtc-flows.transfers.created
								</div>
							</div>
						</div>
					</div>
					<div className="pp-surface">
						<h4>Chain — raw events, no subgraph deployed</h4>
						<p>
							Give it up to 50 triggers and it starts matching at the tip.
							Nothing to deploy, nothing to index, no handler to write — the
							right shape when you want a notification, not a dataset.
						</p>
						<div className="pp-vis">
							<div className="pp-cli">
								<div>
									<span className="pfx">$</span> sl subscriptions create
									amm-swaps \
								</div>
								<div className="mut">
									&nbsp;&nbsp;&nbsp;--url https://my-app.com/webhook \
								</div>
								<div className="mut">
									&nbsp;&nbsp;&nbsp;--trigger
									&apos;&#123;"type":"contract_call"…&#125;&apos;
								</div>
								<div>
									<span className="ok">✓</span> starts at tip · no backfill
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* THREE GUARANTEES */}
			<section className="pp-section pp-wrap">
				<div className="pp-section-head">
					<h2>
						Delivery you don&apos;t have to babysit.
						<br />
						<span className="dim">Signed, retried, and reversible.</span>
					</h2>
					<p>
						The hard part of webhooks isn&apos;t sending them. It&apos;s proving
						they came from us, surviving your endpoint being down, and telling
						you when the chain takes an event back.
					</p>
					<Link href="/docs/subscriptions" className="pp-docs-link">
						Read the Subscriptions docs <span className="ar">→</span>
					</Link>
				</div>
				<div className="pp-surfaces three">
					<div className="pp-surface">
						<h4>Signed</h4>
						<p>
							Every delivery, in every format, carries an ed25519 signature over
							the body. On standard-webhooks you also get a per-subscription
							HMAC.
						</p>
						<div className="pp-vis">
							<div className="pp-req">
								<div>
									<span className="res">webhook-id:</span> msg_2rF9…
								</div>
								<div>
									<span className="res">x-secondlayer-signature:</span>
								</div>
								<div>&nbsp;&nbsp;MEUCIQDx8k…</div>
								<div>
									<span className="res">…-signature-keyid:</span> k_04
								</div>
								<div>
									<span className="status">✓</span> verified
								</div>
							</div>
						</div>
					</div>

					<div className="pp-surface">
						<h4>Retried</h4>
						<p>
							Failures back off and retry. If your endpoint stays down, the
							circuit opens so one dead receiver can&apos;t block the queue
							behind it.
						</p>
						<div className="pp-vis">
							<div className="pp-cli">
								<div>
									503 attempt 1 <span className="mut">· retry in 2s</span>
								</div>
								<div>
									503 attempt 2 <span className="mut">· retry in 8s</span>
								</div>
								<div>
									503 attempt 3 <span className="mut">· retry in 32s</span>
								</div>
								<div>
									⊘ circuit open <span className="mut">· queue unblocked</span>
								</div>
								<div>
									<span className="ok">200</span> recovered{" "}
									<span className="mut">· resuming</span>
								</div>
							</div>
						</div>
					</div>

					<div className="pp-surface">
						<h4>Reversible</h4>
						<p>
							A reorg delivers chain.reorg.rollback listing every orphaned event
							you were already sent — so your state can be corrected, not just
							appended to.
						</p>
						<div className="pp-vis">
							<div className="pp-cli">
								<div>
									<span className="mut">"action":</span> "rollback"
								</div>
								<div>
									<span className="mut">"fork_point_height":</span> 8249711
								</div>
								<div>
									<span className="mut">"orphaned":</span> [
								</div>
								<div>&nbsp;&nbsp;&#123; tx_id: "0x9a…" &#125;,</div>
								<div>&nbsp;&nbsp;&#123; tx_id: "0x3c…" &#125; ]</div>
								<div>
									<span className="mut">"truncated":</span> false
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* TRIGGERS */}
			<section className="pp-band">
				<div className="pp-wrap pp-section">
					<div className="pp-section-head">
						<h2>
							Seventeen triggers.
							<br />
							<span className="dim">
								Wildcards, traits and amount floors included.
							</span>
						</h2>
						<p>
							Match a contract call by name pattern, an FT transfer above a
							threshold, a print event on a topic, or the full sBTC peg
							lifecycle. Validation is strict per type — a mint takes a
							recipient, a burn takes a sender, anything else is a 400 before
							you ever deploy.
						</p>
					</div>
					<div className="pp-chips">
						{TRIGGERS.map((t) => (
							<span key={t.name} className={t.lead ? "pp-chip idx" : "pp-chip"}>
								{t.name}
							</span>
						))}
					</div>
					<div className="pp-window pp-win-solo pp-subs-code">
						<div className="pp-bar">
							<div className="pp-dots">
								<i />
								<i />
								<i />
							</div>
							<div className="pp-title">triggers.ts</div>
						</div>
						<div className="pp-editor">
							<CodeBlock code={TRIGGERS_CODE} lang="typescript" />
						</div>
					</div>
				</div>
			</section>

			{/* FORMATS */}
			<section className="pp-section pp-wrap">
				<div className="pp-section-head">
					<h2>
						It arrives in the shape your stack already reads.
						<br />
						<span className="dim">Six formats, one payload.</span>
					</h2>
					<p>
						Point a subscription at Inngest, Trigger.dev or a Cloudflare Worker
						and the body lands in the shape that runtime expects. Same{" "}
						<code>data</code> value in every one, just a different wrapper.
					</p>
				</div>
				<div className="pp-formats">
					<table>
						<thead>
							<tr>
								<th>Format</th>
								<th>Where data lives</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{FORMATS.map((f) => (
								<tr key={f.name}>
									<td className="fmt">{f.name}</td>
									<td className="shape">{f.shape}</td>
									<td>
										{f.note ? <span className="tag">{f.note}</span> : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			{/* SELF-HOST — the wedge: hosted Chainhook can't run anywhere else */}
			<section className="pp-section pp-wrap">
				<div className="pp-section-head">
					<h2>
						The whole thing is MIT.
						<br />
						<span className="dim">
							Including the part that delivers your webhooks.
						</span>
					</h2>
					<p>
						Hosted is the default and most people should stay there. But
						subscriptions aren&apos;t a service you can only rent from us —{" "}
						<code>docker compose up</code> runs the indexer, API and subgraph
						processor on your own hardware, with every surface attached: Index,
						Streams, Subgraphs, Subscriptions.
					</p>
					<Link href="/docs/self-host" className="pp-docs-link">
						Read the self-host guide <span className="ar">→</span>
					</Link>
				</div>
				<div className="pp-surfaces two">
					<div className="pp-window pp-subs-code">
						<div className="pp-bar">
							<div className="pp-dots">
								<i />
								<i />
								<i />
							</div>
							<div className="pp-title">docker/oss</div>
						</div>
						<div className="pp-editor">
							<CodeBlock code={SELF_HOST_CODE} lang="bash" />
						</div>
					</div>
					<div className="pp-catches">
						<div className="pp-catch">
							<span className="k">Why it matters here</span>
							<h4>Hosted Chainhook can&apos;t be run anywhere else</h4>
							<p>
								Chainhook v2 is hosted-only, and self-hosted v1 is archived. If
								you need webhook delivery inside your own perimeter — a
								compliance boundary, an air-gapped chain, or simply not wanting
								a third party between the chain and your database — that&apos;s
								the gap this fills. Same API, same SDK, same triggers; the only
								difference is whose machine it runs on.
							</p>
						</div>
						<div className="pp-catch">
							<span className="k">And locally</span>
							<h4>Devnet is a first-class target</h4>
							<p>
								<code>sl devnet connect</code> wires a Clarinet devnet in one
								step, so you can fire real subscriptions at a local contract
								before it ever touches mainnet. Hosted Chainhook v2 skips devnet
								entirely.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* REPLAY + THE HONEST CATCH */}
			<section className="pp-section pp-wrap">
				<div className="pp-surfaces two">
					<div>
						<div className="pp-section-head">
							<h2>Ship the fix, then replay the history.</h2>
							<p>
								Re-deliver a past block range over an existing subscription.
								Replays are idempotent, historical only, and never move your
								live cursor — so catching up can&apos;t cost you the tip. Capped
								at 100,000 blocks and flagged <code>is_replay</code>.
							</p>
						</div>
						<div className="pp-window pp-subs-code">
							<div className="pp-bar">
								<div className="pp-dots">
									<i />
									<i />
									<i />
								</div>
								<div className="pp-title">replay.ts</div>
							</div>
							<div className="pp-editor">
								<CodeBlock code={REPLAY_CODE} lang="typescript" />
							</div>
						</div>
					</div>
					<div className="pp-catch">
						<span className="k">The catch, stated plainly</span>
						<h4>Delivery is at-least-once</h4>
						<p>
							We would rather send a webhook twice than lose it once, so your
							receiver has to be idempotent. Key your state on{" "}
							<code>(tx_id, event_index, block_hash)</code> — one transaction
							can fire several event-level deliveries that share a{" "}
							<code>tx_id</code>, and <code>event_index</code> is what keeps
							them apart. It is <code>-1</code> for tx-level triggers.
						</p>
						<p>
							Two more worth knowing before you build: <code>orphaned</code> in
							a rollback caps at 500 entries, so if <code>truncated</code> is
							true, treat everything at or above the fork point as gone rather
							than trusting the list. And discriminate on{" "}
							<code>data.trigger</code>, never <code>event.type</code> — the
							latter is the node&apos;s raw event name and does not match what
							you subscribed with.
						</p>
					</div>
				</div>
			</section>

			{/* RECENT HIGHLIGHTS — derived from /docs/changelog */}
			{highlights.length > 0 && (
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
			)}

			<section className="pp-final">
				<div className="pp-wrap">
					<h2>
						Point it at your endpoint.
						<br />
						Forget about it.
					</h2>
					<p>
						Signed, retried, and honest about forks. One command to create, one
						function to verify — on our hardware or yours.
					</p>
					<div className="pp-ctas">
						<Link href="/docs/subscriptions" className="pp-btn pp-btn-ink">
							Create a subscription
						</Link>
						<Link
							href="/docs/migrate-chainhook"
							className="pp-btn pp-btn-ghost"
						>
							Coming from Chainhook v2? →
						</Link>
					</div>
				</div>
			</section>
		</main>
	);
}
