import { CodeBlock } from "@/components/code-block";
import { GITHUB_URL } from "@/components/github-nav-link";
import {
	ButtonLink,
	CloseBand,
	Eyebrow,
	Faq,
	Highlight,
	Meters,
	Odometer,
	Props,
	SelfHostSlot,
	Split,
	StatusDot,
	Terminal,
} from "@/components/site";
import { StreamsHero } from "@/components/site/assets";
import { socialMeta } from "@/lib/og";
import { PRODUCTS } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";

const LEDE =
	"A long-running pull from any point in chain history, one event per line. You decide where to resume, and reorgs are a list you can read.";

export const metadata: Metadata = socialMeta({
	title: "Streams · secondlayer",
	description: LEDE,
	image: "/og/streams.png",
	path: "/streams",
});

const [archive, streams, index, subgraphs, webhooks] = PRODUCTS;

const BACKFILL = `// signed dumps first, then live from the seam
await streams.events.replay({
  from: "genesis",
  async onDumpFile(file, { from }) {
    const bytes = await streams.dumps.download(file); // sha256-verified
    await ingestParquet(bytes, { after: from });
  },
  async onBatch(events, envelope) {
    await db.insertEvents(events);
    return envelope.next_cursor;
  },
});`;

const CURSORS: readonly { at: string; label: string }[] = [
	{ at: "506:19", label: "read" },
	{ at: "506:24", label: "read" },
	{ at: "507:03", label: "cursor" },
	{ at: "507:08", label: "next" },
	{ at: "…", label: "tip" },
];

export default function StreamsPage() {
	return (
		<main className="site product">
			<div className="shell">
				<p className="crumb">
					Products / <b>Streams</b>
				</p>
				<div className="hero">
					<div className="hero-copy">
						<Eyebrow noun={streams.noun} verb={streams.verb} />
						<h1>
							Hold your <Highlight>own cursor</Highlight>
						</h1>
						<p className="lede">{LEDE}</p>
						<div className="btns">
							<ButtonLink href="/login">Start a consumer</ButtonLink>
							<ButtonLink href="/docs/streams" variant="secondary">
								Read the docs
							</ButtonLink>
						</div>
						<p className="cap">$5 per 1M rows · first 1M free every month</p>
						<Odometer
							value={245540999}
							label="events you can replay from genesis · snapshot signed 2026-09-09"
						/>
					</div>
					<div className="hero-art">
						<StreamsHero />
					</div>
				</div>

				<Props
					items={[
						{
							icon: (
								<svg
									viewBox="0 0 20 20"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.4"
									aria-hidden="true"
								>
									<path d="M4 10a6 6 0 1 0 2-4.5" />
									<path d="M4 3v3.5h3.5" />
								</svg>
							),
							title: "Resume, don't restart",
							body: (
								<>
									The cursor is <span className="mono">height:index</span>.
									Write it down, and a killed consumer picks up where it
									stopped.
								</>
							),
						},
						{
							icon: (
								<svg
									viewBox="0 0 20 20"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.4"
									aria-hidden="true"
								>
									<path d="M4 6h12M4 10h8M4 14h10" />
								</svg>
							),
							title: "jsonl, so pipe it anywhere",
							body: (
								<>
									One event per line on stdout. <span className="mono">jq</span>
									, a file, a queue, Postgres. Your sink, no config to learn.
								</>
							),
						},
						{
							icon: (
								<svg
									viewBox="0 0 20 20"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.4"
									aria-hidden="true"
								>
									<path d="M3 15 8 9l3 3 6-7" />
									<path d="M13 5h4v4" />
								</svg>
							),
							title: "Reorgs are a list you can read",
							body: (
								<>
									A fork rewinds to the fork point and re-delivers.{" "}
									<span className="mono">streams reorgs</span> pages the
									history, so you can reconcile.
								</>
							),
						},
					]}
				/>
			</div>

			<div className="band band-soft">
				<div className="shell">
					<Split
						copy={
							<>
								<Eyebrow noun="The consumer" />
								<h2>One command, until you stop it</h2>
								<p className="lede">
									<span className="mono">streams consume</span> pulls from a
									cursor and prints jsonl until you stop it. Filters run before
									the wire, so a consumer for one asset pays for one asset.
								</p>
								<div className="chips">
									{[
										"--types · --not-types",
										"--contract-id",
										"--sender · --recipient",
										"--batch-size",
										"--max-pages",
									].map((c) => (
										<span className="chip" key={c}>
											{c}
										</span>
									))}
								</div>
							</>
						}
						art={
							<div className="art tail">
								<div className="tail-head">
									<span className="pulling">
										<i />
										pulling
									</span>
									<span>secondlayer streams consume --types ft_transfer</span>
									<span className="sp">example output</span>
								</div>
								<pre>
									{'{"block_height":'}
									<span className="t-a">{"8948506"}</span>
									{',"event_index":12,"type":"ft_transfer"}\n{"block_height":'}
									<span className="t-a">{"8948506"}</span>
									{',"event_index":19,"type":"ft_transfer"}\n{"block_height":'}
									<span className="t-a">{"8948506"}</span>
									{',"event_index":24,"type":"ft_transfer"}\n{"block_height":'}
									<span className="t-a">{"8948507"}</span>
									{',"event_index":3,"type":"ft_transfer"}\n{"block_height":'}
									<span className="t-a">{"8948507"}</span>
									{',"event_index":8,"type":"ft_transfer"}'}
								</pre>
								<div className="tail-foot">
									cursor 8948507:8 · ^C to stop · --cursor 8948507:8 resumes
									here
								</div>
							</div>
						}
					/>

					<Split
						flip
						copy={
							<>
								<Eyebrow noun="The cursor" />
								<h2>Two numbers, total ordering</h2>
								<p className="lede">
									Block height plus event index orders every event on the chain
									exactly once. That pair is the whole checkpoint. No consumer
									group, no offset topic, no broker to run.
								</p>
								<ol className="cursor-row" aria-label="Cursor positions">
									{CURSORS.map((c) => (
										<li
											key={c.at + c.label}
											data-at={c.label === "cursor" ? "" : undefined}
										>
											<b>{c.at}</b>
											{c.label}
										</li>
									))}
								</ol>
							</>
						}
						art={
							<Terminal title="~/consumer" meta="streams">
								<pre>
									<span className="t-a">{"❯"}</span>
									{" secondlayer streams tip\n"}
									<span className="t-m">{"  block_height      8,948,506"}</span>
									{"\n"}
									<span className="t-m">{"  finalized_height  8,948,262"}</span>
									{"\n\n"}
									<span className="t-a">{"❯"}</span>
									{
										" secondlayer streams consume \\\n    --types ft_transfer,nft_transfer \\\n    --cursor 8948507:03 --batch-size 500 | jq -c '.type'\n\n"
									}
									<span className="t-a">{"❯"}</span>
									{" secondlayer streams reorgs\n"}
									<span className="t-hit">
										{"  ✓ none in the last 1,000 blocks"}
									</span>
									{"\n\n"}
									<span className="t-a">{"❯"}</span>
									{" secondlayer streams by-tx 0x9f2c…"}
								</pre>
							</Terminal>
						}
					/>

					<Split
						copy={
							<>
								<Eyebrow noun="The firehose" />
								<h2>Every frame is signed</h2>
								<p className="lede">
									The SSE stream carries each event with an ed25519 signature.
									The SDK checks every frame against our published key by
									default, so a tampered event fails before your code sees it.
								</p>
								<div className="chips">
									{[
										"SSE · ping every 20s",
										"ed25519 per frame",
										"auto-reconnect from last cursor",
									].map((c) => (
										<span className="chip" key={c}>
											{c}
										</span>
									))}
								</div>
							</>
						}
						art={
							<Terminal title="GET /v1/streams/events/stream" meta="live tail">
								<pre>
									<span className="t-a">{"❯"}</span>
									{
										' curl -N "$SL/v1/streams/events/stream?types=ft_transfer" \\\n    -H "authorization: Bearer sk-sl_…"\n\n'
									}
									<span className="t-m">{"data:"}</span>
									{
										' {\n  "event":  { "cursor": "8948507:03", "type": "ft_transfer", … },\n  "sig":    '
									}
									<span className="t-a">{'"3f9a…c41e"'}</span>
									{',\n  "key_id": "streams-2026"\n}\n'}
									<span className="t-hit">
										{"  ✓ signature verified · /public/streams/signing-key"}
									</span>
								</pre>
							</Terminal>
						}
					/>

					<Split
						flip
						copy={
							<>
								<Eyebrow noun="History" />
								<h2>Backfill from signed dumps, then tail live</h2>
								<p className="lede">
									<span className="mono">events.replay</span> reads the
									finalized parquet dumps, then switches to the live stream at
									the manifest's last finalized cursor. No gap and no duplicate
									at the seam.
								</p>
								<div className="chips">
									{[
										"signed manifest",
										"sha256 per file",
										"DuckDB-ready parquet",
									].map((c) => (
										<span className="chip" key={c}>
											{c}
										</span>
									))}
								</div>
							</>
						}
						art={
							<Terminal title="backfill.ts" meta="@secondlayer/sdk">
								<CodeBlock code={BACKFILL} lang="typescript" />
							</Terminal>
						}
					/>

					<Meters
						items={[
							{
								label: "Capacity meter",
								value: "$0",
								body: "Nothing runs on our side between pulls. A consumer you are not running costs nothing.",
							},
							{
								label: "Volume meter",
								value: "$5 / 1M rows",
								body: "Rows delivered, dropping to $2 per 1M past $50 of monthly spend. The first 1M each month are free. Filters cut the bill along with the output.",
							},
						]}
					/>
				</div>
			</div>

			<div className="band">
				<div className="shell btc">
					<div className="sec-head" style={{ margin: 0 }}>
						<Eyebrow noun="Bitcoin" />
						<h2>Runes on the same loop</h2>
						<p className="lede">
							<span className="mono">chain=bitcoin</span> serves Runes events on
							their own cursor space, from block 840,000, checked against ord
							with 0 mismatches.
						</p>
						<StatusDot state="rolling" />
						<div className="types">
							{["rune_etch", "rune_mint", "rune_transfer", "rune_burn"].map(
								(t) => (
									<span key={t}>{t}</span>
								),
							)}
						</div>
					</div>
					<Terminal title="GET /v1/streams/events" meta="your instance">
						<pre>
							<span className="t-a">{"❯"}</span>
							{' curl "$SL/v1/streams/events?chain=bitcoin&rune=840000:3"\n\n'}
							<span className="t-m">{"{"}</span>
							{
								'\n  "events": [{ "type": "rune_transfer", "block_height": 968557,\n               "rune": "840000:3", "ts": … }],\n  "next_cursor": '
							}
							<span className="t-a">{'"968557:41"'}</span>
							{"\n"}
							<span className="t-m">{"}"}</span>
							{"\n"}
							<span className="t-m">
								{"  example · a bitcoin cursor resumes only with chain=bitcoin"}
							</span>
						</pre>
					</Terminal>
				</div>
			</div>

			<div className="band" style={{ paddingTop: 0 }}>
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Which one" />
						<h2>
							They read the same index. The difference is who holds the state.
						</h2>
					</div>
					<div className="which">
						<Link href={streams.href} aria-current="page">
							<span className="k">
								{streams.noun} · {streams.verb} · this page
							</span>
							<h3>You hold the cursor</h3>
							<p>
								Best when you already run a sink and a supervisor, and want no
								state on our side.
							</p>
							<span className="go">you are here</span>
						</Link>
						<Link href={subgraphs.href}>
							<span className="k">
								{subgraphs.noun} · {subgraphs.verb}
							</span>
							<h3>We hold the table</h3>
							<p>
								Best when the shape is settled and you would rather read a
								computed table than rebuild it on every boot.
							</p>
							<span className="go">{subgraphs.href} →</span>
						</Link>
						<Link href={webhooks.href}>
							<span className="k">
								{webhooks.noun} · {webhooks.verb}
							</span>
							<h3>We hold the retry queue</h3>
							<p>
								Best when you want chain events pushed to your server, with
								failed deliveries logged and requeueable.
							</p>
							<span className="go">{webhooks.href} →</span>
						</Link>
					</div>
				</div>
			</div>

			<div className="band" style={{ paddingTop: 0 }}>
				<div className="shell">
					<div className="sec-head" style={{ marginBottom: 24 }}>
						<Eyebrow noun="Rest of the platform" />
					</div>
					<div className="rest">
						<Link href={index.href}>
							<span className="k">
								{index.noun} · {index.verb}
							</span>
							<span className="n">Index</span>
							<p>The decoded set these events come from, as typed rows.</p>
						</Link>
						<Link href={archive.href}>
							<span className="k">
								{archive.noun} · {archive.verb}
							</span>
							<span className="n">Archive</span>
							<p>
								The signed history behind the dumps. Checking your copy is free.
							</p>
						</Link>
						<Link href="/verify">
							<span className="k">Verify</span>
							<span className="n">Verify</span>
							<p>
								Check blocks and state writes against the chain, with no trust
								in us.
							</p>
						</Link>
					</div>
				</div>
			</div>

			<SelfHostSlot
				refs={
					<>
						<Link href="/docs/self-host">docs/self-host</Link>
						<a href={GITHUB_URL}>GitHub</a>
					</>
				}
			>
				Hosted is <span className="mono">api.secondlayer.tools</span>. Point{" "}
				<span className="mono">SECONDLAYER_API_URL</span> at your own instance
				and the same CLI, SDK and <span className="mono">/v1/streams</span>{" "}
				routes answer. Reads over loopback need no key, so a local consumer pays
				nothing per row.
			</SelfHostSlot>

			<div className="band">
				<div className="shell faq-grid">
					<div className="sec-head" style={{ margin: 0 }}>
						<Eyebrow noun="FAQ" />
						<h2>Streams questions</h2>
					</div>
					<Faq
						items={[
							{
								q: "What exactly is the cursor?",
								a: (
									<>
										<code>block_height:event_index</code>, a total order over
										chain events. Store it wherever you store anything, and pass{" "}
										<code>--cursor</code> to resume.
									</>
								),
							},
							{
								q: "What happens on a reorg?",
								a: (
									<>
										The consumer rewinds to the fork point and re-delivers from
										there, fork block included. Delivery is at least once, so
										keep writes idempotent. Anything above{" "}
										<code>finalized_height</code> is provisional until six
										Bitcoin confirmations.
									</>
								),
							},
							{
								q: "Can I read everything one transaction emitted?",
								a: (
									<>
										Yes. <code>streams by-tx &lt;txId&gt;</code> returns every
										event it emitted. <code>block-events</code> does the same
										for a height or hash, and{" "}
										<code>canonical &lt;height&gt;</code> returns block
										metadata.
									</>
								),
							},
							{
								q: "Is this push or pull?",
								a: "A pull you keep open, over REST pages or SSE. To have chain events pushed to your server instead, use Webhooks: same events, our retry queue.",
							},
							{
								q: "Do filters reduce the bill?",
								a: (
									<>
										Yes. The meter counts rows delivered, so{" "}
										<code>--types</code> and <code>--contract-id</code> cut the
										bill and the output together.
									</>
								),
							},
						]}
					/>
				</div>
			</div>

			<CloseBand
				title={
					<>
						Have a consumer tailing <Highlight>today</Highlight>
					</>
				}
				cta={
					<>
						<ButtonLink href="/login">Start free</ButtonLink>
						<ButtonLink href="/docs/streams" variant="secondary">
							Read the docs
						</ButtonLink>
					</>
				}
				caption="1M rows free every month · pulls from your own instance over loopback cost nothing per row"
			/>
		</main>
	);
}
