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
  origin: "cli", // "cli" | "mcp" | "session" — sent as x-sl-origin on every request
})

// Sub-clients are available as properties:
client.streams      // stream CRUD, deliveries, replay
client.subgraphs    // subgraph deploy, query, reindex
client.workflows    // workflow deploy, source, rollback, tail`}
				/>

				<div className="prose">
					<p>
						The optional <code>origin</code> option marks every outbound request
						with an <code>x-sl-origin</code> header — the server logs it on
						every deploy so you can slice telemetry by surface (terminal, chat
						session, or external MCP client). The default is <code>cli</code>.
					</p>
				</div>

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

// Bundle TypeScript source on the server (no local esbuild required)
const bundled = await client.subgraphs.bundle({ code: tsSource })
// → { name, version, sources, schema, handlerCode, sourceCode, bundleSize }

// Read the stored TypeScript source (powers chat read/edit loop)
const source = await client.subgraphs.getSource("token-transfers")
if (source.readOnly) console.log(source.reason) // pre-capture rows return readOnly

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
						multi-step tasks with AI analysis, MCP tool calls, subgraph queries,
						and delivery to webhooks, Slack, Discord, Telegram, or email.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`import { SecondLayer, VersionConflictError } from "@secondlayer/sdk"

// Deploy a workflow
//
// deploy() is overloaded:
//   dryRun: false | undefined  -> DeployResponse  ({ action, workflowId, version, message })
//   dryRun: true               -> DeployDryRunResponse ({ valid, validation, bundleSize })
//
// expectedVersion opts into optimistic concurrency — the server returns 409 if another
// deploy landed since your last read. Wrap in try/catch for VersionConflictError.
try {
  const result = await client.workflows.deploy({
    name: "whale-alerts",
    trigger: { type: "event", filter: { type: "stx_transfer" } },
    handlerCode: bundledCode,
    sourceCode: tsSource,                 // raw TS — powers chat edits
    expectedVersion: "1.0.3",             // 409 on mismatch
    clientRequestId: crypto.randomUUID(), // 30s dedupe window
  })
  console.log(result.version)             // e.g. "1.0.4"
} catch (err) {
  if (err instanceof VersionConflictError) {
    console.log("current is", err.currentVersion)
  }
}

// Validate a bundle without persisting
const check = await client.workflows.deploy({
  name: "whale-alerts",
  trigger: { type: "event", filter: { type: "stx_transfer" } },
  handlerCode: bundledCode,
  dryRun: true,
})
if (!check.valid) console.error(check.error)

// Read the stored TypeScript source
const source = await client.workflows.getSource("whale-alerts")
if (source.readOnly) console.log(source.reason) // pre-capture rows return readOnly

// Roll back to a prior on-disk bundle (new patch version, audit trail)
await client.workflows.rollback("whale-alerts")                // previous version
await client.workflows.rollback("whale-alerts", "1.0.2")       // specific version

// Bulk pause + in-flight cancel
await client.workflows.pauseAll()
await client.workflows.cancelRun(runId)

// Live tail — SSE with typed WorkflowTailEvent union (step / done / heartbeat / timeout)
const controller = new AbortController()
await client.workflows.streamRun("whale-alerts", runId, (event) => {
  if (event.type === "step") console.log(event.step.stepId, event.step.status)
  if (event.type === "done") console.log("final status:", event.done.status)
}, controller.signal)

// Standard CRUD
const { workflows } = await client.workflows.list()
const detail = await client.workflows.get("whale-alerts")
const { runId: manualRunId } = await client.workflows.trigger("whale-alerts", {
  threshold: 100_000,
})
await client.workflows.pause("whale-alerts")
await client.workflows.resume("whale-alerts")
const { runs } = await client.workflows.listRuns("whale-alerts", { status: "completed", limit: 10 })
const run = await client.workflows.getRun("run-id")
await client.workflows.delete("whale-alerts")`}
				/>

				<SectionHeading id="error-handling">Error handling</SectionHeading>

				<div className="prose">
					<p>
						All SDK methods throw <code>ApiError</code> on failure. The error
						includes the HTTP status code, a descriptive message, and the parsed
						response <code>body</code> for callers that need error details.
						Certain endpoints throw typed subclasses instead —{" "}
						<code>VersionConflictError</code> for workflow deploy conflicts
						(HTTP 409) carries <code>currentVersion</code> and{" "}
						<code>expectedVersion</code> so you can re-read and retry.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`import { ApiError, VersionConflictError } from "@secondlayer/sdk"

try {
  await client.streams.get("nonexistent")
} catch (err) {
  if (err instanceof ApiError) {
    err.status   // 404
    err.message  // "Stream not found"
    err.body     // parsed response body ({ error, code, ... })
  }
}

// Workflow version conflicts are surfaced as a typed subclass
try {
  await client.workflows.deploy({ ..., expectedVersion: "1.0.3" })
} catch (err) {
  if (err instanceof VersionConflictError) {
    // err.status === 409
    // err.currentVersion  // server's actual stored version
    // err.expectedVersion // what you sent
  }
}

// Common status codes:
// 401 — API key invalid or expired
// 404 — Resource not found
// 409 — VersionConflictError (workflow deploy w/ stale expectedVersion)
// 413 — Bundle too large (subgraphs 4 MB, workflows 1 MB)
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
							DeployResponse — overloaded: returns DeployDryRunResponse when{" "}
							<code>dryRun: true</code>
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">deploy.data</span>
						<span className="prop-type">
							name, trigger, handlerCode, sourceCode?, expectedVersion?,
							dryRun?, clientRequestId?, retries?, timeout?
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
						<span className="prop-name">getSource(name)</span>
						<span className="prop-type">
							WorkflowSource {"{"} name, version, sourceCode: string | null,
							readOnly, reason?, updatedAt {"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">rollback(name, toVersion?)</span>
						<span className="prop-type">
							{"{"}action, fromVersion, restoredFromVersion, version{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">pauseAll()</span>
						<span className="prop-type">
							{"{"}paused: number, workflows{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">cancelRun(runId)</span>
						<span className="prop-type">
							{"{"}runId, status, cancelled, completedAt?{"}"}
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">
							streamRun(name, runId, onEvent, signal?)
						</span>
						<span className="prop-type">
							Promise&lt;void&gt; — resolves on done / timeout / abort
						</span>
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

					<div className="props-group-title">Errors</div>

					<div className="prop-row">
						<span className="prop-name">ApiError</span>
						<span className="prop-type">
							status, message, body (parsed response)
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">VersionConflictError</span>
						<span className="prop-type">
							extends ApiError — currentVersion, expectedVersion (status 409)
						</span>
					</div>

					<div className="props-group-title">Exports</div>

					<div className="prop-row">
						<span className="prop-name">@secondlayer/sdk</span>
						<span className="prop-type">
							SecondLayer, Streams, Subgraphs, Workflows, getSubgraph, ApiError,
							VersionConflictError
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
