import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";

const toc: TocItem[] = [
	{ label: "Getting started", href: "#getting-started" },
	{ label: "Subgraphs", href: "#subgraphs" },
	{ label: "Typed subgraphs", href: "#typed-subgraphs" },
	{ label: "Subscriptions", href: "#subscriptions" },
	{ label: "Error handling", href: "#error-handling" },
];

export default function SdkPage() {
	return (
		<div className="article-layout">
			<Sidebar title="SDK" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">SDK</h1>
				</header>

				<div className="prose">
					<p>
						A TypeScript client for the platform. Deploy subgraphs, query
						tables, manage row-change subscriptions — same auth, same
						operations as the CLI and MCP server.
					</p>
					<p>
						Install with <code>bun add @secondlayer/sdk</code>.
					</p>
				</div>

				<SectionHeading id="getting-started">Getting started</SectionHeading>

				<CodeBlock
					lang="typescript"
					code={`import { SecondLayer } from "@secondlayer/sdk"

const client = new SecondLayer({ apiKey: "sk-sl_..." })

client.subgraphs       // deploy, query, reindex
client.subscriptions   // create, list, update, delete`}
				/>

				<SectionHeading id="subgraphs">Subgraphs</SectionHeading>

				<CodeBlock
					lang="typescript"
					code={`// Query a table
const { data, meta } = await client.subgraphs.queryTable(
  "token-transfers",
  "transfers",
  {
    sort: "_block_height",
    order: "desc",
    limit: 50,
    filters: { sender: "SP1234...", "amount.gte": "1000000" },
  }
)

// Count rows
const { count } = await client.subgraphs.queryTableCount(
  "token-transfers",
  "transfers",
  { filters: { sender: "SP1234..." } }
)`}
				/>

				<SectionHeading id="typed-subgraphs">Typed subgraphs</SectionHeading>

				<div className="prose">
					<p>
						Import your subgraph definition to get a fully typed query client —
						table names, column names, and filter operators all inferred from
						your schema.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`import { getSubgraph } from "@secondlayer/sdk"
import mySubgraph from "./subgraphs/token-transfers"

const typed = getSubgraph(mySubgraph, { apiKey: "sk-sl_..." })

const rows = await typed.transfers.findMany({
  where: { sender: { eq: "SP1234..." }, amount: { gte: 1000000n } },
  orderBy: { _blockHeight: "desc" },
  limit: 25,
})

const total = await typed.transfers.count({ sender: { eq: "SP1234..." } })`}
				/>

				<SectionHeading id="subscriptions">Subscriptions</SectionHeading>

				<div className="prose">
					<p>
						Subscribe to row changes on any subgraph table. The emitter POSTs
						signed payloads (Standard Webhooks by default — verify with any
						Svix library) with retries and a per-subscription circuit breaker.
						Supported wire formats: <code>standard-webhooks</code>,{" "}
						<code>inngest</code>, <code>trigger</code>, <code>cloudflare</code>,
						<code>cloudevents</code>, <code>raw</code>.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`// Create a subscription
const sub = await client.subscriptions.create({
  subgraph: "token-transfers",
  table: "transfers",
  event: "insert",                           // insert | update | delete
  url: "https://example.com/hooks/transfers",
  format: "standard-webhooks",               // default
  filter: { amount: { gte: "1000000000" } }, // scalar DSL
})

console.log(sub.signingSecret)               // use to verify signatures

await client.subscriptions.list({ subgraph: "token-transfers" })
await client.subscriptions.update(sub.id, { paused: true })
await client.subscriptions.delete(sub.id)`}
				/>

				<SectionHeading id="error-handling">Error handling</SectionHeading>

				<CodeBlock
					lang="typescript"
					code={`import { ApiError, VersionConflictError } from "@secondlayer/sdk"

try {
  await client.subgraphs.get("nonexistent")
} catch (err) {
  if (err instanceof ApiError) {
    err.status   // 404
    err.message  // "Subgraph not found"
  }
}

// 401 invalid key  |  404 not found  |  409 version conflict
// 413 bundle too large  |  429 rate limited  |  5xx server error`}
				/>
			</main>
		</div>
	);
}
