import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Subscriptions | secondlayer",
	description:
		"Push semantics. Subscribe to your subgraph table writes — server delivers signed webhooks.",
};

const toc: TocItem[] = [
	{ label: "Quickstart", href: "#quickstart" },
	{ label: "Filters", href: "#filters" },
	{ label: "on.* factories", href: "#on-factories" },
	{ label: "Signing", href: "#signing" },
	{ label: "Replay & DLQ", href: "#replay-dlq" },
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
						Push matched events to your webhook URL. Subscriptions bind to a
						subgraph table — every row your handler writes that matches the
						filter triggers a signed HTTP POST. For pull semantics see{" "}
						<a href="/streams">Streams</a>.
					</p>
				</div>

				<SectionHeading id="quickstart">Quickstart</SectionHeading>

				<CodeBlock
					code={`# Scaffold a receiver project; runtimes: inngest | trigger | cloudflare | node
sl create subscription my-watcher --runtime node

# Or programmatically:
import { createClient } from "@secondlayer/sdk";
await createClient(...).subscriptions.create({
  name: "my-watcher",
  subgraphName: "my-watcher",
  tableName: "transfers",
  url: "https://my-app.com/webhook",
  format: "standard-webhooks",
});`}
				/>

				<SectionHeading id="filters">Filters</SectionHeading>

				<CodeBlock
					code={`// {column: value} maps. Bare value = eq. Operators: eq, neq, gt, gte, lt, lte, in.
{
  filter: {
    recipient: "SP1ABC...",
    amount: { gte: "1000000" }
  }
}`}
				/>

				<SectionHeading id="on-factories">on.* factories</SectionHeading>

				<CodeBlock
					code={`import { on } from "@secondlayer/stacks";

// Each factory takes {subgraph, table} first — bind to a table you own.
const spec = on.transferTo(
  { subgraph: "my-watcher", table: "transfers" },
  "SP1ABC...",
  { asset: "SP1...usdc::usdc-token" },
);

await sdk.subscriptions.create({ ...spec, name: "watch", url: "https://..." });

// Available: on.transferTo, on.sip010Transfer, on.sip009Transfer,
//            on.bnsName, on.poxStack, on.sbtcDeposit, on.sbtcWithdrawal`}
				/>

				<SectionHeading id="signing">Signing</SectionHeading>

				<CodeBlock
					code={`# Default format: standard-webhooks. Every delivery carries:
webhook-id:        msg_<id>
webhook-timestamp: <unix-seconds>
webhook-signature: v1,<base64-hmac>

# signature = HMAC-SHA256("<id>.<timestamp>.<body>", secret)
# Rotate via: sl subscriptions rotate-secret <id>
#
# Other formats: inngest, trigger, cloudflare, cloudevents, raw`}
					lang="text"
				/>

				<SectionHeading id="replay-dlq">Replay & DLQ</SectionHeading>

				<CodeBlock
					code={`# Failed deliveries fall back through 30s → 2m → 10m → 1h → 6h → 24h → 72h.
# After 7 attempts they land in the DLQ; 20 consecutive failures pause the sub.
# Inspect at /platform/subgraphs/<name>/subscriptions/<id>.

await sdk.subscriptions.replay(id, { fromBlock: 123000, toBlock: 124000 });`}
				/>
			</main>
		</div>
	);
}
