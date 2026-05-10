import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Subscriptions | secondlayer",
	description:
		"Push semantics for chain events. Subscribe to your subgraph table writes — server delivers signed webhooks with retries, replay, and DLQ.",
};

const toc: TocItem[] = [
	{ label: "Overview", href: "#overview" },
	{ label: "Quickstart", href: "#quickstart" },
	{ label: "Filters", href: "#filters" },
	{ label: "on.* factories", href: "#on-factories" },
	{ label: "Runtimes", href: "#runtimes" },
	{ label: "Signing", href: "#signing" },
	{ label: "Formats", href: "#formats" },
	{ label: "Replay & DLQ", href: "#replay-dlq" },
];

function InlineCodeBlock({ children }: { children: string }) {
	return (
		<pre className="code-block">
			<code>{children.trim()}</code>
		</pre>
	);
}

export default function SubscriptionsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Subscriptions" toc={toc} />
			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">Subscriptions</h1>
				</header>

				<SectionHeading id="overview">Overview</SectionHeading>

				<div className="prose">
					<p>
						Subscriptions push matched events to your webhook URL. They bind to
						a subgraph table — every time the subgraph runtime writes a row that
						matches your filter, an outbox row is enqueued and a signed HTTP
						POST is delivered to your endpoint.
					</p>
					<p>
						If you want pull semantics — cursor-walk every event yourself — use{" "}
						<a href="/docs/streams">Streams</a> instead. Push and pull are
						different products; pick whichever shape your workload needs.
					</p>
				</div>

				<SectionHeading id="quickstart">Quickstart</SectionHeading>

				<div className="prose">
					<p>Scaffold a subscription handler from a runtime template:</p>
				</div>

				<InlineCodeBlock>
					sl create subscription my-watcher --runtime node
				</InlineCodeBlock>

				<div className="prose">
					<p>
						The CLI prompts for the subgraph + table to bind, the webhook URL,
						and provisions the subscription on the platform. Templates exist for
						<code> inngest </code>, <code> trigger </code>,
						<code> cloudflare </code>, and vanilla <code> node </code>.
					</p>
				</div>

				<SectionHeading id="filters">Filters</SectionHeading>

				<div className="prose">
					<p>
						Filters are <code>{"{column: value}"}</code> maps against your
						subgraph table's columns. Bare values mean equality; operator forms
						support <code>eq</code>, <code>neq</code>, <code>gt</code>,{" "}
						<code>gte</code>, <code>lt</code>, <code>lte</code>, <code>in</code>
						.
					</p>
				</div>

				<InlineCodeBlock>
					{`{
  "subgraphName": "my-watcher",
  "tableName": "transfers",
  "filter": {
    "recipient": "SP1ABC...",
    "amount": { "gte": "1000000" }
  }
}`}
				</InlineCodeBlock>

				<SectionHeading id="on-factories">on.* factories</SectionHeading>

				<div className="prose">
					<p>
						<code>@secondlayer/stacks</code> exports typed <code>on.*</code>{" "}
						factories that produce these filter specs. Each factory takes{" "}
						<code>{"{subgraph, table}"}</code> first — bind to a table you own
						(e.g. one scaffolded via{" "}
						<code>sl subgraphs new --template sip-010-balances</code>):
					</p>
				</div>

				<InlineCodeBlock>
					{`import { createClient as sdk } from "@secondlayer/sdk";
import { on } from "@secondlayer/stacks";

const spec = on.transferTo(
  { subgraph: "my-watcher", table: "transfers" },
  "SP1ABC...",
  { asset: "SP1...usdc::usdc-token" },
);

await sdk(...).subscriptions.create({
  ...spec,
  name: "watch-incoming-usdc",
  url: "https://my-app.com/webhook",
  format: "standard-webhooks",
});`}
				</InlineCodeBlock>

				<div className="prose">
					<p>
						Available factories: <code>on.transferTo</code>,{" "}
						<code>on.sip010Transfer</code>, <code>on.sip009Transfer</code>,{" "}
						<code>on.bnsName</code>, <code>on.poxStack</code>,{" "}
						<code>on.sbtcDeposit</code>, <code>on.sbtcWithdrawal</code>.
					</p>
				</div>

				<SectionHeading id="runtimes">Runtimes</SectionHeading>

				<div className="prose">
					<p>
						<code>sl create subscription</code> scaffolds a project for one of
						four runtimes, each pre-wired to verify the webhook signature and
						parse the typed payload:
					</p>
					<ul>
						<li>
							<code>inngest</code> — POSTs to <code>inn.gs/e/{"{key}"}</code>
						</li>
						<li>
							<code>trigger</code> — POSTs to a Trigger.dev task with a Bearer
							token
						</li>
						<li>
							<code>cloudflare</code> — POSTs to a Cloudflare Workflows endpoint
						</li>
						<li>
							<code>node</code> — vanilla HTTP server with{" "}
							<code>standard-webhooks</code> verification
						</li>
					</ul>
				</div>

				<SectionHeading id="signing">Signing</SectionHeading>

				<div className="prose">
					<p>
						Default format is <code>standard-webhooks</code>: every delivery
						carries <code>webhook-id</code>, <code>webhook-timestamp</code>, and{" "}
						<code>webhook-signature</code> headers. Signature is{" "}
						<code>HMAC-SHA256({"<id>.<timestamp>.<body>"}, secret)</code> where
						the secret is provisioned at sub-create time and rotatable via{" "}
						<code>sl subscriptions rotate-secret</code> or{" "}
						<code>sdk.subscriptions.rotateSecret(id)</code>.
					</p>
				</div>

				<SectionHeading id="formats">Formats</SectionHeading>

				<div className="prose">
					<p>
						Choose your delivery shape via <code>format</code>:
					</p>
					<ul>
						<li>
							<code>standard-webhooks</code> (default) — generic POST + HMAC
							headers
						</li>
						<li>
							<code>inngest</code> / <code>trigger</code> /{" "}
							<code>cloudflare</code> — runtime-specific envelopes
						</li>
						<li>
							<code>cloudevents</code> — CloudEvents v1.0 spec
						</li>
						<li>
							<code>raw</code> — your unwrapped payload + configurable
							Content-Type
						</li>
					</ul>
				</div>

				<SectionHeading id="replay-dlq">Replay & DLQ</SectionHeading>

				<div className="prose">
					<p>
						Failed deliveries fall back through an exponential backoff schedule
						(30s → 2m → 10m → 1h → 6h → 24h → 72h, 7 attempts). After the last
						attempt, the row lands in the dead-letter queue, visible at{" "}
						<code>
							/platform/subgraphs/{"<name>"}/subscriptions/{"<id>"}
						</code>
						. Twenty consecutive failures pause the subscription via the circuit
						breaker.
					</p>
					<p>
						Replay any historical block range via{" "}
						<code>sdk.subscriptions.replay(id, {"{fromBlock, toBlock}"})</code>{" "}
						— matching rows are re-emitted to your webhook with a fresh dedup
						key.
					</p>
				</div>
			</main>
		</div>
	);
}
