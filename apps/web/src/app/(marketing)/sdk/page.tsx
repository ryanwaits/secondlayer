import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";

const toc: TocItem[] = [
	{ label: "Getting started", href: "#getting-started" },
	{ label: "Streams", href: "#streams" },
	{ label: "Subgraphs", href: "#subgraphs" },
	{ label: "Typed subgraphs", href: "#typed-subgraphs" },
	{ label: "Workflows", href: "#workflows" },
	{ label: "Error handling", href: "#error-handling" },
	{ label: "Props", href: "#props" },
];

export default function SdkPage() {
	return (
		<div className="article-layout">
			<Sidebar title="SDK" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">SDK</h1>
					<p className="page-date">March 10, 2026</p>
				</header>

				<div className="prose">
					<p>
						The Second Layer SDK is a typed TypeScript client for the Second
						Layer API. It handles authentication, request formatting, and
						response parsing so you can focus on building.
					</p>
					<p>
						Install with <code>bun add @secondlayer/sdk</code>.
					</p>
				</div>

				<SectionHeading id="getting-started">Getting started</SectionHeading>

				<div className="prose">
					<p>
						Create a client instance with your API key. The default base URL
						points to the hosted API.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`import { SecondLayer } from "@secondlayer/sdk"

const client = new SecondLayer({
  apiKey: "sk-sl_...",
  baseUrl: "https://api.secondlayer.tools", // default
})

// Sub-clients are available as properties:
client.streams      // stream CRUD, deliveries, replay
client.subgraphs    // subgraph deploy, query, reindex
client.workflows    // workflow deploy, trigger, runs`}
				/>

				<SectionHeading id="streams">Streams</SectionHeading>

				<div className="prose">
					<p>
						Create and manage event streams. Streams deliver matching onchain
						events to your endpoint in real-time.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`// Create — returns stream + signing secret for HMAC verification
const { stream, signingSecret } = await client.streams.create({
  name: "my-stream",
  endpointUrl: "https://example.com/streams",
  filters: [
    { type: "stx_transfer", minAmount: 1_000_000 },
  ],
})

// List (optionally filter by status)
const { streams, total } = await client.streams.list({ status: "active" })

// Get by ID (supports partial IDs)
const stream = await client.streams.get("a1b2c3")

// Update filters or endpoint URL
await client.streams.update("a1b2c3", {
  filters: [{ type: "contract_call", contractId: "SP1234...::token" }],
})

// Enable / disable / delete
await client.streams.enable("a1b2c3")
await client.streams.disable("a1b2c3")
await client.streams.delete("a1b2c3")

// Bulk operations
await client.streams.pauseAll()
await client.streams.resumeAll()

// Rotate signing secret
const { secret } = await client.streams.rotateSecret("a1b2c3")

// Inspect deliveries
const { deliveries } = await client.streams.listDeliveries("a1b2c3", {
  limit: 20,
  status: "failed",
})
const detail = await client.streams.getDelivery("a1b2c3", "delivery-id")`}
				/>

				<SectionHeading id="subgraphs">Subgraphs</SectionHeading>

				<div className="prose">
					<p>
						Deploy, query, and manage indexed subgraphs. The query API supports
						filtering with comparison operators, sorting, pagination, field
						selection, and full-text search.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`// List deployed subgraphs
const { data } = await client.subgraphs.list()

// Get subgraph details (tables, health, row counts)
const subgraph = await client.subgraphs.get("token-transfers")

// Query a table
const { data, meta } = await client.subgraphs.queryTable(
  "token-transfers",
  "transfers",
  {
    sort: "_block_height",
    order: "desc",
    limit: 50,
    filters: { sender: "SP1234...", "amount.gte": "1000000" },
    fields: "sender,recipient,amount",
  }
)
// meta = { total, limit, offset }

// Count rows
const { count } = await client.subgraphs.queryTableCount(
  "token-transfers",
  "transfers",
  { filters: { sender: "SP1234..." } }
)

// Reindex from scratch
await client.subgraphs.reindex("token-transfers", {
  fromBlock: 150_000,
  toBlock: 160_000,
})

// Delete subgraph and all data
await client.subgraphs.delete("token-transfers")`}
				/>

				<SectionHeading id="typed-subgraphs">Typed subgraphs</SectionHeading>

				<div className="prose">
					<p>
						Import a subgraph definition to get a fully typed query client.
						Table names, column names, and filter operators are all inferred
						from your schema.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`import { getSubgraph } from "@secondlayer/sdk"
import mySubgraph from "./subgraphs/token-transfers"

// Standalone helper — accepts options, SecondLayer instance, or Subgraphs instance
const client = getSubgraph(mySubgraph, { apiKey: "sk-sl_..." })

const rows = await client.transfers.findMany({
  where: { sender: { eq: "SP1234..." }, amount: { gte: 1000000n } },
  orderBy: { _blockHeight: "desc" },
  limit: 25,
})

const total = await client.transfers.count({
  sender: { eq: "SP1234..." },
})

// Or via the SecondLayer instance
const typed = client.subgraphs.typed(mySubgraph)
const rows = await typed.transfers.findMany({ ... })`}
				/>

				<SectionHeading id="workflows">Workflows</SectionHeading>

				<div className="prose">
					<p>
						Deploy, trigger, and manage automated workflows. Workflows run
						multi-step tasks with AI analysis, MCP tool calls, subgraph
						queries, and delivery to webhooks, Slack, Discord, Telegram, or
						email.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`// Deploy a workflow
const result = await client.workflows.deploy({
  name: "whale-alerts",
  trigger: { type: "event", filter: { type: "stx_transfer" } },
  handlerCode: bundledCode,
})

// List workflows
const { workflows } = await client.workflows.list()

// Get details
const detail = await client.workflows.get("whale-alerts")

// Trigger manually (with optional input)
const { runId } = await client.workflows.trigger("whale-alerts", {
  threshold: 100_000,
})

// Pause / resume
await client.workflows.pause("whale-alerts")
await client.workflows.resume("whale-alerts")

// List runs (filter by status)
const { runs } = await client.workflows.listRuns("whale-alerts", {
  status: "completed",
  limit: 10,
})

// Get run details (steps, duration, AI token usage)
const run = await client.workflows.getRun("run-id")

// Delete
await client.workflows.delete("whale-alerts")`}
				/>

				<SectionHeading id="error-handling">Error handling</SectionHeading>

				<div className="prose">
					<p>
						All SDK methods throw <code>ApiError</code> on failure. The error
						includes the HTTP status code and a descriptive message.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`import { ApiError } from "@secondlayer/sdk"

try {
  await client.streams.get("nonexistent")
} catch (err) {
  if (err instanceof ApiError) {
    err.status   // 404
    err.message  // "Stream not found"
  }
}

// Common status codes:
// 401 — API key invalid or expired
// 404 — Resource not found
// 429 — Rate limited (check Retry-After header)
// 5xx — Server error`}
				/>

				<SectionHeading id="props">Props</SectionHeading>

				<div className="props-section">
					<div className="props-group-title">Constructor</div>

					<div className="prop-row">
						<span className="prop-name">apiKey</span>
						<span className="prop-type">string</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">baseUrl</span>
						<span className="prop-type">string</span>
						<span className="prop-default">
							&apos;https://api.secondlayer.tools&apos;
						</span>
					</div>

					<div className="props-group-title">client.streams</div>

					<div className="prop-row">
						<span className="prop-name">create(data)</span>
						<span className="prop-type">
							{"{"}stream, signingSecret{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">list(params?)</span>
						<span className="prop-type">
							{"{"}streams, total{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">get(id)</span>
						<span className="prop-type">StreamResponse</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">update(id, data)</span>
						<span className="prop-type">StreamResponse</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">delete(id)</span>
						<span className="prop-type">void</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">enable(id) / disable(id)</span>
						<span className="prop-type">StreamResponse</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">rotateSecret(id)</span>
						<span className="prop-type">
							{"{"}secret{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">pauseAll() / resumeAll()</span>
						<span className="prop-type">BulkResponse</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">listDeliveries(id, params?)</span>
						<span className="prop-type">
							{"{"}deliveries{"}"}
						</span>
					</div>

					<div className="props-group-title">client.subgraphs</div>

					<div className="prop-row">
						<span className="prop-name">list()</span>
						<span className="prop-type">
							{"{"}data: SubgraphSummary[]{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">get(name)</span>
						<span className="prop-type">SubgraphDetail</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">deploy(data)</span>
						<span className="prop-type">
							{"{"}action, subgraphId, message{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">queryTable(name, table, params?)</span>
						<span className="prop-type">
							{"{"}data, meta{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">
							queryTableCount(name, table, params?)
						</span>
						<span className="prop-type">
							{"{"}count{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">reindex(name, options?)</span>
						<span className="prop-type">
							{"{"}message, fromBlock, toBlock{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">delete(name)</span>
						<span className="prop-type">void</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">typed(def)</span>
						<span className="prop-type">InferSubgraphClient</span>
					</div>

					<div className="props-group-title">client.workflows</div>

					<div className="prop-row">
						<span className="prop-name">deploy(data)</span>
						<span className="prop-type">
							{"{"}action, workflowId, message{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">list()</span>
						<span className="prop-type">
							{"{"}workflows: WorkflowSummary[]{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">get(name)</span>
						<span className="prop-type">WorkflowDetail</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">trigger(name, input?)</span>
						<span className="prop-type">
							{"{"}runId{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">pause(name) / resume(name)</span>
						<span className="prop-type">void</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">delete(name)</span>
						<span className="prop-type">void</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">listRuns(name, params?)</span>
						<span className="prop-type">
							{"{"}runs: WorkflowRunSummary[]{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">getRun(runId)</span>
						<span className="prop-type">WorkflowRun</span>
					</div>

					<div className="props-group-title">Exports</div>

					<div className="prop-row">
						<span className="prop-name">@secondlayer/sdk</span>
						<span className="prop-type">
							SecondLayer, Streams, Subgraphs, Workflows, getSubgraph, ApiError
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">@secondlayer/sdk/streams</span>
						<span className="prop-type">Streams</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">@secondlayer/sdk/subgraphs</span>
						<span className="prop-type">Subgraphs, getSubgraph</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">@secondlayer/sdk/workflows</span>
						<span className="prop-type">Workflows</span>
					</div>
				</div>
			</main>
		</div>
	);
}
