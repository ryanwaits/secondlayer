import { CodeBlock } from "@/components/code-block";
import { GITHUB_URL } from "@/components/github-nav-link";
import {
	ButtonLink,
	CloseBand,
	Eyebrow,
	Faq,
	Highlight,
	Meters,
	Props,
	RestOfPlatform,
	SelfHostSlot,
	Split,
	StatusDot,
	Terminal,
} from "@/components/site";
import { WebhooksHero } from "@/components/site/assets";
import { socialMeta } from "@/lib/og";
import { PRODUCTS } from "@/lib/site";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

const LEDE =
	"A signed POST to your URL when a chain event you named lands. Retried while your server is down, rolled back when a fork orphans the block.";

export const metadata: Metadata = socialMeta({
	title: "Webhooks · secondlayer",
	description: LEDE,
	image: "/og/webhooks.png",
	path: "/p/webhooks",
});

const [, , , , webhooks] = PRODUCTS;

const RECEIVER = `import { verifyWebhookSignature, decodeChainWebhook }
  from "@secondlayer/sdk";

// raw body first, before any JSON parsing
if (!verifyWebhookSignature(rawBody, req.headers, secret))
  return new Response("bad signature", { status: 401 });

const delivery = decodeChainWebhook(rawBody);
switch (delivery.data.trigger) {
  case "contract_call": // fully typed
}`;

const ROLLBACK = `{
  "type": "chain.reorg.rollback",
  "data": {
    "action": "rollback",
    "fork_point_height": 9137006,
    "orphaned": [
      { "tx_id": "0x9f2c…", "event": { "event_index": 3, … } }
    ],
    "truncated": false
  }
}`;

const TRIGGERS: readonly {
	name: string;
	status: "live" | "rolling";
	types: readonly string[];
	body: ReactNode;
}[] = [
	{
		name: "STX",
		status: "live",
		types: ["stx_transfer", "stx_mint", "stx_burn", "stx_lock"],
		body: "Filter by sender, recipient, or an amount range.",
	},
	{
		name: "Tokens",
		status: "live",
		types: [
			"ft_transfer",
			"ft_mint",
			"ft_burn",
			"nft_transfer",
			"nft_mint",
			"nft_burn",
		],
		body: "Scope to one asset, or to every SIP-010 or SIP-009 token at once.",
	},
	{
		name: "Contracts",
		status: "live",
		types: ["contract_call", "contract_deploy", "print_event"],
		body: (
			<>
				Match function names with <code>swap-*</code>, or every print from one
				contract by topic.
			</>
		),
	},
	{
		name: "sBTC",
		status: "live",
		types: [
			"sbtc_deposit",
			"sbtc_withdrawal_create",
			"…_accept",
			"…_reject",
			"…_swept_confirmed",
		],
		body: "Swept-confirmed fires once, when the sweep reaches 6 Bitcoin confirmations.",
	},
	{
		name: "Runes",
		status: "rolling",
		types: ["rune_etch", "rune_mint", "rune_transfer", "rune_burn"],
		body: "By rune id or name, on Bitcoin blocks from 840,000.",
	},
	{
		name: "PoX-5",
		status: "live",
		types: ["print_event · pox-5"],
		body: (
			<>
				Stacking prints by topic, such as <code>register-for-bond</code>, as
				they land.
			</>
		),
	},
];

const OPS: readonly { title: string; body: string; cmd: string }[] = [
	{
		title: "Retried, then held",
		body: "Failed deliveries retry with backoff, up to 7 times hosted. After that the circuit opens so one dead endpoint can't block the queue, and the events wait for you.",
		cmd: "secondlayer webhooks dead amm-swaps\nsecondlayer webhooks requeue amm-swaps <id>",
	},
	{
		title: "Diagnosed in plain numbers",
		body: "Five fixed rules read your last 100 attempts: rate-limited, down, rejecting, slow, or lag on our side. Each one shows the evidence it fired on.",
		cmd: "secondlayer webhooks doctor amm-swaps",
	},
	{
		title: "Replayed on purpose",
		body: "Re-deliver up to 100,000 historical blocks over the same webhook. Replays are flagged, idempotent, and never move the live cursor.",
		cmd: "secondlayer webhooks replay amm-swaps \\\n  --from-block 9100000 --to-block 9137000",
	},
];

const FORMATS = [
	"standard-webhooks",
	"raw",
	"cloudevents",
	"inngest",
	"trigger",
	"cloudflare",
] as const;

export default function WebhooksPage() {
	return (
		<main className="site product">
			<div className="shell">
				<div className="hero">
					<div className="hero-copy">
						<Eyebrow noun={webhooks.noun} verb={webhooks.verb} />
						<h1>
							Your server, <Highlight>told first.</Highlight>
						</h1>
						<p className="lede">{LEDE}</p>
						<div className="btns">
							<ButtonLink href="/login">Create a webhook</ButtonLink>
							<ButtonLink href="/docs/webhooks" variant="secondary">
								Read the docs
							</ButtonLink>
						</div>
						<p className="cap">
							$10 per 1M delivered events · retries never billed
						</p>
						<div className="odo">
							<span className="odo-n">27 triggers</span>
							<span className="cap">
								stx_transfer to rune_burn · 1 to 50 per webhook · wildcards and
								traits
							</span>
						</div>
					</div>
					<div className="hero-art">
						<WebhooksHero />
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
									<path d="M10 2.6 16.5 6v5.2c0 3-2.8 5.2-6.5 6.2-3.7-1-6.5-3.2-6.5-6.2V6z" />
									<path d="M7.4 10.2 9.4 12l3.4-3.6" />
								</svg>
							),
							title: "Signed in every format",
							body: "Every delivery carries an ed25519 signature, whatever body shape you pick. Check it with one published public key.",
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
									<path d="M16 6.5a6.5 6.5 0 1 0 1.2 5.5" />
									<path d="M16 3v4h-4" />
								</svg>
							),
							title: "Forks undo themselves",
							body: "A reorg sends one rollback listing everything that may have reached you, so your state follows the chain back.",
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
									<path d="M3 15V5M3 15h14" />
									<path d="M6 12l3-3 3 2 4-5" />
								</svg>
							),
							title: "Failures you can read",
							body: "The last 100 attempts, with a diagnosis. Failed events wait for you to resend them, so nothing is silently dropped.",
						},
					]}
				/>
			</div>

			<div className="band band-soft">
				<div className="shell">
					<Split
						copy={
							<>
								<Eyebrow noun="Create one" />
								<h2>One command, no subgraph to deploy</h2>
								<p className="lede">
									Name the events you care about and the URL to send them to. It
									starts at the chain tip, and the signing secret prints once.
								</p>
								<div className="chips">
									{[
										"1 to 50 triggers",
										"* wildcards",
										"trait: sip-010",
										"minAmount",
									].map((c) => (
										<span className="chip" key={c}>
											{c}
										</span>
									))}
								</div>
							</>
						}
						art={
							<Terminal title="~/my-app" meta="secondlayer">
								<pre>
									<span className="t-a">{"❯"}</span>
									{
										' secondlayer webhooks create amm-swaps \\\n    --url https://my-app.com/webhook \\\n    --trigger \'{"type":"contract_call",\n               "contractId":"SP….amm","functionName":"swap-*"}\' \\\n    --trigger \'{"type":"sbtc_deposit"}\'\n'
									}
									<span className="t-m">{"  triggers   2 validated"}</span>
									{"\n"}
									<span className="t-m">{"  starts at  chain tip"}</span>
									{"\n"}
									<span className="t-m">{"  secret     "}</span>
									<span className="t-a">
										{"whsec_…  (shown once, store it now)"}
									</span>
									{"\n"}
									<span className="t-hit">{"  ✓ amm-swaps live"}</span>
									{"\n"}
									<span className="t-a">{"❯"}</span>
									{" secondlayer webhooks test amm-swaps --post\n"}
									<span className="t-hit">
										{"  ✓ 200 · chain.test.apply · 63 ms"}
									</span>
								</pre>
							</Terminal>
						}
					/>

					<Split
						flip
						copy={
							<>
								<Eyebrow noun="Check it's us" />
								<h2>Two lines before you trust a body</h2>
								<p className="lede">
									The default format carries a per-webhook HMAC. Every format
									also carries our ed25519 signature over the delivery id and
									raw body, so a payload from anyone else fails both.
								</p>
								<div className="chips">
									{[
										"standard-webhooks",
										"x-secondlayer-signature",
										"keyid header for rotation",
									].map((c) => (
										<span className="chip" key={c}>
											{c}
										</span>
									))}
								</div>
							</>
						}
						art={
							<Terminal title="receiver.ts" meta="@secondlayer/sdk">
								<CodeBlock code={RECEIVER} lang="typescript" />
							</Terminal>
						}
					/>

					<Split
						copy={
							<>
								<Eyebrow noun="Reorgs" />
								<h2>When a fork orphans a block, you hear about it</h2>
								<p className="lede">
									The rollback names the fork point and lists every event that
									may have arrived, including ones whose response never made it
									back. Undo each entry and your state matches the chain again.
								</p>
								<div className="chips">
									{[
										"chain.reorg.rollback",
										"fork_point_height",
										"finality · 6 btc confirmations",
									].map((c) => (
										<span className="chip" key={c}>
											{c}
										</span>
									))}
								</div>
							</>
						}
						art={
							<Terminal title="POST /webhook" meta="example delivery">
								<CodeBlock code={ROLLBACK} lang="json" />
							</Terminal>
						}
					/>

					<Meters
						items={[
							{
								label: "Volume meter",
								value: "$10 / 1M events",
								body: "Counted when an event is delivered. A webhook that never fires costs nothing.",
							},
							{
								label: "Never billed",
								value: "Retries",
								body: "Nor the rows we read to match your triggers. A flaky receiver never raises the bill.",
							},
						]}
					/>
				</div>
			</div>

			<div className="band">
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Triggers" />
						<h2>Every event Stacks emits, and the protocols on top</h2>
						<p className="lede">
							Each trigger accepts only the fields that make sense for it, so a
							typo is a 400 at create time instead of a webhook that never
							fires.
						</p>
					</div>
					<div className="trig">
						{TRIGGERS.map((t) => (
							<div className="tg" key={t.name}>
								<div className="tg-head">
									<h3>{t.name}</h3>
									<StatusDot state={t.status} />
								</div>
								<div className="types">
									{t.types.map((type) => (
										<span key={type}>{type}</span>
									))}
								</div>
								<p>{t.body}</p>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="band" style={{ paddingTop: 0 }}>
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="When it goes wrong" />
						<h2>Your server will go down. Here is what happens next.</h2>
					</div>
					<div className="ops">
						{OPS.map((o) => (
							<div key={o.title}>
								<h3>{o.title}</h3>
								<p>{o.body}</p>
								<code className="cmd">{o.cmd}</code>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="band" style={{ paddingTop: 0 }}>
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Formats" />
						<h2>Arrives in the shape your stack already reads</h2>
						<p className="lede">
							The same event data in every format, under the key that format
							expects. Pick one per webhook.
						</p>
					</div>
					<div className="types">
						{FORMATS.map((f) => (
							<span key={f}>{f}</span>
						))}
					</div>
				</div>
			</div>

			<div className="band" style={{ paddingTop: 0 }}>
				<div className="shell">
					<div className="sec-head">
						<Eyebrow noun="Rest of the platform" />
						<h2>
							Same chain, other surfaces. The difference is who holds the state.
						</h2>
					</div>
					<RestOfPlatform
						exclude={["/p/webhooks", "/p/archive"]}
						blurbs={{
							"/p/streams": {
								title: "You hold the cursor",
								body: "Best when you already run a consumer and would rather pull than be pushed to.",
							},
							"/p/subgraphs": {
								title: "We hold the table",
								body: "Best when the shape is settled and you want rows to query, not events to process.",
							},
							"/p/index": {
								title: "You ask, we answer",
								body: "Best for history and lookups: every event from genesis, typed, behind one key.",
							},
						}}
					/>
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
				Hosted webhooks run on{" "}
				<span className="mono">api.secondlayer.tools</span>, one isolated stack
				per account. On your own box the same CLI, SDK and delivery semantics
				apply, with your limits instead of ours, and Runes triggers already work
				there.
			</SelfHostSlot>

			<div className="band">
				<div className="shell faq-grid">
					<div className="sec-head" style={{ margin: 0 }}>
						<Eyebrow noun="FAQ" />
						<h2>Webhooks questions</h2>
					</div>
					<Faq
						items={[
							{
								q: "Are deliveries ordered?",
								a: (
									<>
										No. Delivery is at-least-once and unordered. Key your state
										on <code>(tx_id, event_index, block_hash)</code> and don't
										assume arrival order matches chain order.
									</>
								),
							},
							{
								q: "What happens on a reorg?",
								a: (
									<>
										You get one <code>chain.reorg.rollback</code> listing every
										event that may have reached you from the orphaned blocks.
										Undo each one. Anything above the finalized height, six
										Bitcoin confirmations back, is provisional.
									</>
								),
							},
							{
								q: "Can a new webhook backfill history?",
								a: "A new webhook starts at the chain tip. To send history, replay a range of up to 100,000 blocks over it. For bulk history, read the Index instead.",
							},
							{
								q: "Do I pay for retries?",
								a: "No. You pay $10 per 1M events delivered. Retries, and the rows we read to match your triggers, are never billed.",
							},
							{
								q: "How do I know a delivery came from you?",
								a: (
									<>
										Every delivery carries an ed25519 signature over{" "}
										<code>webhook-id.rawBody</code>, checkable against our
										published public key. The default format adds a per-webhook
										HMAC on top.
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
						Have your server told first <Highlight>today</Highlight>
					</>
				}
				cta={
					<>
						<ButtonLink href="/login">Start free</ButtonLink>
						<ButtonLink href="/docs/webhooks" variant="secondary">
							Read the docs
						</ButtonLink>
					</>
				}
				caption="$10 per 1M delivered events · retries never billed"
			/>
		</main>
	);
}
