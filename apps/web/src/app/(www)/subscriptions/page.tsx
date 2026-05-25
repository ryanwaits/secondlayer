import { Callout } from "@/components/callout";
import { CodeBlock } from "@/components/code-block";
import { SubscriptionsDiagram } from "@/components/diagrams/subscriptions-diagram";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Subscriptions | secondlayer",
	description:
		"Push, not poll. Matched subgraph rows fire a signed, retried webhook — wire chain events into anything that speaks HTTP.",
};

const toc: TocItem[] = [
	{ label: "How it works", href: "#how-it-works" },
	{ label: "Subscribe", href: "#subscribe" },
	{ label: "Delivery", href: "#delivery" },
];

export default function SubscriptionsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Subscriptions" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">Subscriptions</h1>
				</header>

				<div className="prose">
					<p>
						Push instead of poll. A subscription binds to a{" "}
						<Link href="/subgraphs">subgraph</Link> table — every row your
						handler writes that matches your filter fires a signed, retried
						webhook. Point it at Discord, Slack, Trigger.dev, or your own
						backend — anything that speaks HTTP.
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
sl create subscription whale-alerts --runtime node

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

				<SectionHeading id="delivery">Delivery</SectionHeading>

				<div className="prose">
					<p>
						Deliveries are signed with{" "}
						<a href="https://www.standardwebhooks.com">standard-webhooks</a>{" "}
						(HMAC-SHA256) by default. Failures back off and, if they keep
						failing, land in a DLQ — and you can replay any block range.
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
			</main>
		</div>
	);
}
