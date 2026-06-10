import { Callout } from "@/components/callout";
import { CodeBlock } from "@/components/code-block";
import { SubscriptionsDiagram } from "@/components/diagrams/subscriptions-diagram";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import { SectionHeading } from "@/components/section-heading";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Subscriptions | secondlayer",
	description:
		"Push, not poll. Fire a signed, retried webhook on matched subgraph rows — or on raw chain events with no subgraph at all.",
};

export default function SubscriptionsPage() {
	return (
		<main className="explore-wrap">
			<MarketingPageHeader crumb="Products" here="Subscriptions" title={<>Subscriptions</>} />
			<div className="mk-body">

				<div className="prose">
					<p>
						Push instead of poll. A subscription fires a signed, retried
						webhook — point it at Discord, Slack, Trigger.dev, or your own
						backend, anything that speaks HTTP. Two kinds: bind to a{" "}
						<Link href="/subgraphs">subgraph</Link> table and fire on the rows
						your handler writes, or skip the subgraph entirely and fire on{" "}
						<a href="#chain-subscriptions">raw chain events</a>.
					</p>
					<p>
						For pull semantics, see <Link href="/streams">Streams</Link>.
					</p>
				</div>

				<SectionHeading id="how-it-works">How it works</SectionHeading>

				<SubscriptionsDiagram />

				<div className="prose">
					<p>
						On each matching write the row lands in an outbox; a delivery worker
						signs it and POSTs to your URL, retrying with backoff until it
						lands. No polling loop to run, no cursor to track.
					</p>
				</div>

				<SectionHeading id="subscribe">Subscribe</SectionHeading>

				<div className="prose">
					<p>
						Scaffold a receiver for your runtime, or create one programmatically
						against a table you own:
					</p>
				</div>

				<CodeBlock
					code={`# Scaffold a receiver — runtimes: inngest | trigger | cloudflare | node
sl subscriptions create whale-alerts --runtime node

# Or via the SDK
await sdk.subscriptions.create({
  name: "whale-alerts",
  subgraphName: "token-transfers",
  tableName: "transfers",
  url: "https://my-app.com/webhook",
  filter: { recipient: "SP1ABC...", amount: { gte: "1000000" } },
  format: "standard-webhooks",
});`}
				/>

				<div className="prose">
					<p>
						Filters are <code>{"{ column: value }"}</code> maps with operators (
						<code>eq</code>, <code>gte</code>, <code>in</code>, …). Typed{" "}
						<code>on.*</code> factories — <code>on.sip010Transfer</code>,{" "}
						<code>on.sbtcDeposit</code>, <code>on.poxStack</code> and more —
						build common specs for you.
					</p>
				</div>

				<SectionHeading id="chain-subscriptions">
					Chain subscriptions
				</SectionHeading>

				<div className="prose">
					<p>
						A lambda for Stacks. Skip the subgraph deploy and put a webhook
						directly on a contract, an event, a function, or a SIP trait. A
						chain subscription takes a <code>triggers</code> array instead of a
						table — it&apos;s forward-looking, starting at the chain tip with no
						backfill, and fires the moment a matching event lands.
					</p>
				</div>

				<CodeBlock
					code={`import { trigger } from "@secondlayer/sdk";

await sl.subscriptions.create({
  name: "amm-swaps",
  url: "https://my-app.com/webhook",
  triggers: [
    trigger.contractCall({ contractId: "SP....amm", functionName: "swap-*" }),
    trigger.ftTransfer({ trait: "sip-010", minAmount: "1000000" }),
  ],
});`}
					lang="ts"
				/>

				<div className="prose">
					<p>
						Builders cover every event type — <code>trigger.contractCall</code>,{" "}
						<code>trigger.contractDeploy</code>, <code>trigger.printEvent</code>,
						and the <code>stx*</code>/<code>ft*</code>/<code>nft*</code> transfer,
						mint, and burn variants. Each takes filter fields (
						<code>contractId</code>, <code>functionName</code>,{" "}
						<code>sender</code>, <code>recipient</code>, <code>minAmount</code>,{" "}
						<code>trait</code>, …), <code>*</code> wildcards are allowed, and{" "}
						<code>trait</code> scopes a trigger to a whole SIP. The raw object form
						(<code>{'{ type: "contract_call", functionName: "swap-*" }'}</code>)
						works too.
					</p>
					<p>
						Chain subscriptions are created via the SDK, REST (
						<code>POST /api/subscriptions</code> with <code>triggers</code>), or
						MCP. (CLI <code>create</code> remains subgraph-only.)
					</p>
				</div>

				<SectionHeading id="delivery">Delivery</SectionHeading>

				<div className="prose">
					<p>
						Deliveries are signed with{" "}
						<a href="https://www.standardwebhooks.com">standard-webhooks</a>{" "}
						(HMAC-SHA256) by default. Failures back off and, if they keep
						failing, land in a DLQ — and you can replay any block range.
					</p>
					<p>
						Chain subscriptions deliver a{" "}
						<code>chain.{"{type}"}.apply</code> envelope (
						<code>block_hash</code>, <code>block_height</code>,{" "}
						<code>tx_id</code>, <code>canonical</code>, the matched{" "}
						<code>trigger</code>, and the <code>event</code>); a reorg sends{" "}
						<code>chain.reorg.rollback</code> with the{" "}
						<code>fork_point_height</code> and the orphaned events. Delivery is
						at-least-once, so key your state on{" "}
						<code>(tx_id, block_hash)</code>.
					</p>
				</div>

				<CodeBlock
					code={`# Headers on every delivery (standard-webhooks):
webhook-id:        msg_<id>
webhook-timestamp: <unix-seconds>
webhook-signature: v1,<base64-hmac>

# Retries: 30s → 2m → 10m → 1h → 6h → 24h → 72h, then DLQ.
# Replay a range:
#   await sdk.subscriptions.replay(id, { fromBlock, toBlock })`}
					lang="text"
				/>

				<Callout label="Full reference">
					<p>
						All filter operators, the <code>on.*</code> factory catalog, every
						signing format, and replay/DLQ details live in the docs →{" "}
						<Link href="/docs/subscriptions">/docs/subscriptions</Link>.
					</p>
				</Callout>
			</div>
		</main>
	);
}
