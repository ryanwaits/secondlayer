import { BoxBadge } from "@/components/box-badge";
import { CodeBlock } from "@/components/code-block";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import { MARKETING_WORKFLOWS_PROMPT } from "@/lib/agent-prompts";

const toc: TocItem[] = [
	{ label: "Getting started", href: "#getting-started" },
	{ label: "Triggers", href: "#triggers" },
	{ label: "Steps", href: "#steps" },
	{ label: "AI analysis", href: "#ai-analysis" },
	{ label: "MCP tools", href: "#mcp-tools" },
	{ label: "Querying subgraphs", href: "#querying-subgraphs" },
	{ label: "Delivering results", href: "#delivering-results" },
	{ label: "Deploy", href: "#deploy" },
	{ label: "Templates", href: "#templates" },
	{ label: "Chat authoring", href: "#chat-authoring" },
	{ label: "Versioning & rollback", href: "#versioning" },
	{ label: "Live tail", href: "#live-tail" },
	{ label: "Management", href: "#management" },
	{ label: "Props", href: "#props" },
];

export default function WorkflowsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Workflows" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">
						Workflows <BoxBadge>Coming soon</BoxBadge>
					</h1>
				</header>

				<div className="prose">
					<p>
						Workflows automate intelligence on your onchain data. Define
						multi-step tasks that trigger on blockchain events, run on a
						schedule, or fire on demand — secondlayer handles execution,
						retries, and observability. Each step runs independently and retries
						on failure without re-running earlier steps.
					</p>
					<p>
						Install with <code>bun add @secondlayer/workflows</code>.
					</p>
				</div>

				<AgentPromptBlock
					title="Set up workflows with your agent."
					code={MARKETING_WORKFLOWS_PROMPT}
					collapsible
				/>

				<SectionHeading id="getting-started">Getting started</SectionHeading>

				<div className="prose">
					<p>
						A workflow has two parts: a trigger (when to run) and a handler
						(what to do). Handlers are built from steps — isolated units of work
						that retry independently and memoize results across failures.
					</p>
				</div>

				<CodeBlock
					code={`import { defineWorkflow } from "@secondlayer/workflows"

export default defineWorkflow({
  name: "whale-alert",
  trigger: {
    type: "event",
    filter: { type: "stx_transfer", minAmount: 100_000_000_000 },
  },
  handler: async ({ event, step }) => {
    const context = await step.run("enrich", async () => {
      const sender = await step.query("accounts", "balances", {
        where: { address: { eq: event.sender } },
      })
      return { ...event, senderBalance: sender[0]?.balance }
    })

    const analysis = await step.ai("assess-risk", {
      prompt: \`Whale transfer of \${event.amount} microSTX from \${event.sender}. Sender balance: \${context.senderBalance}. Is this unusual?\`,
    })

    if (analysis.riskScore > 0.7) {
      await step.deliver("alert", {
        type: "webhook",
        url: "https://api.example.com/alerts",
        body: { transfer: context, analysis },
      })
    }
  },
})`}
				/>

				<SectionHeading id="triggers">Triggers</SectionHeading>

				<div className="prose">
					<p>
						Four trigger types. Event and stream triggers use the same filter
						types as streams and subgraphs. Stream triggers fire the workflow
						directly when a block matches — no external webhook needed. Schedule
						triggers use cron expressions. Manual triggers accept typed input
						via the API or dashboard.
					</p>
				</div>

				<CodeBlock
					code={`// Trigger on blockchain events — same filters as streams
trigger: {
  type: "event",
  filter: { type: "stx_transfer", minAmount: 50_000_000_000 },
}

// Stream trigger — fires directly when a block matches, no webhook
trigger: {
  type: "stream",
  filter: { type: "contract_call", contractId: "SP1234...::dex", functionName: "swap" },
}

// Trigger on a schedule
trigger: {
  type: "schedule",
  cron: "0 8 * * *",        // 8 AM UTC daily
  timezone: "America/Chicago",
}

// Trigger manually via API or dashboard
trigger: {
  type: "manual",
  input: {
    contractId: { type: "string", required: true },
    depth: { type: "string", default: "shallow" },
  },
}`}
				/>

				<SectionHeading id="steps">Steps</SectionHeading>

				<div className="prose">
					<p>
						Steps are the building blocks of a workflow. Each{" "}
						<code>step.run()</code> call is isolated — it retries on failure
						without re-running completed steps. Use <code>Promise.all()</code>{" "}
						for parallel execution.
					</p>
				</div>

				<CodeBlock
					code={`handler: async ({ event, step }) => {
  // Sequential steps
  const data = await step.run("fetch-data", async () => {
    return await fetchFromAPI(event.contractId)
  })

  const enriched = await step.run("enrich", async () => {
    return await enrichWithMetadata(data)
  })

  // Parallel steps
  const [analysis, history] = await Promise.all([
    step.run("analyze", async () => analyzePatterns(enriched)),
    step.run("get-history", async () => getHistoricalData(enriched)),
  ])

  // Sleep between steps
  await step.sleep("wait-for-settlement", 60_000) // 60 seconds

  // Invoke another workflow
  const result = await step.invoke("deep-analysis", {
    workflow: "contract-analyzer",
    input: { contractId: event.contractId },
  })
}`}
				/>

				<div className="prose" style={{ marginTop: "var(--spacing-sm)" }}>
					<p>
						A complete pipeline — detect large swaps, enrich with subgraph data,
						run AI analysis, and alert via Slack:
					</p>
				</div>

				<CodeBlock
					code={`export default defineWorkflow({
  name: "large-swap-monitor",
  trigger: {
    type: "stream",
    filter: { type: "contract_call", contractId: "SP1234...::amm-pool", functionName: "swap-exact-*" },
  },
  handler: async ({ event, step }) => {
    // 1. Enrich — query subgraph for context
    const context = await step.run("enrich", async () => {
      const [recentSwaps, pool] = await Promise.all([
        step.query("dex-swaps", "swaps", {
          where: { sender: { eq: event.sender }, _blockHeight: { gte: event.block.height - 500 } },
          orderBy: { _blockHeight: "desc" },
          limit: 20,
        }),
        step.query("dex-pools", "pools", {
          where: { contractId: { eq: event.contractId } },
          limit: 1,
        }),
      ])
      return { recentSwaps, pool: pool[0], swapAmount: event.args.amount }
    })

    // 2. Analyze — AI evaluates the pattern
    const analysis = await step.ai("assess-pattern", {
      prompt: \`Large swap of \${context.swapAmount} on pool \${context.pool?.name}. Sender has \${context.recentSwaps.length} swaps in last 500 blocks. Is this unusual activity?\`,
      model: "haiku",
      schema: {
        riskScore: { type: "number", description: "0-1 risk score" },
        pattern: { type: "string", description: "detected pattern name" },
        summary: { type: "string", description: "one-line summary" },
      },
    })

    // 3. Alert — deliver if risk is elevated
    if (analysis.riskScore > 0.5) {
      await step.deliver("notify-team", {
        type: "slack",
        channel: "#dex-alerts",
        text: \`[\${analysis.pattern}] \${analysis.summary} (risk: \${analysis.riskScore})\`,
      })
    }
  },
})`}
				/>

				<SectionHeading id="ai-analysis">AI analysis</SectionHeading>

				<div className="prose">
					<p>
						<code>step.ai()</code> runs an LLM analysis as a discrete step. It
						retries independently, tracks token usage, and returns structured
						output. AI evaluations count toward your tier&apos;s daily
						throughput — when the cap is reached, AI steps are skipped and the
						workflow continues with condition-only logic.
					</p>
				</div>

				<CodeBlock
					code={`// Basic analysis — returns unstructured text
const insight = await step.ai("summarize-activity", {
  prompt: \`Summarize the trading activity for \${contractId} over the last 24 hours: \${JSON.stringify(trades)}\`,
})
// insight.text → "Trading volume increased 340% driven by..."

// Structured output — returns typed object
const assessment = await step.ai("risk-assessment", {
  prompt: \`Analyze this transfer pattern for anomalies: \${JSON.stringify(transfers)}\`,
  schema: {
    riskScore: { type: "number", description: "0-1 risk score" },
    flags: { type: "array", items: "string" },
    recommendation: { type: "string" },
  },
})
// assessment.riskScore → 0.82
// assessment.flags → ["unusual_volume", "new_recipient"]

// Model selection — defaults to haiku, use sonnet for complex analysis
const deepAnalysis = await step.ai("deep-analysis", {
  prompt: "...",
  model: "sonnet",
  schema: { ... },
})`}
				/>

				<SectionHeading id="mcp-tools">MCP tools</SectionHeading>

				<div className="prose">
					<p>
						<code>step.mcp()</code> calls tools on external MCP servers —
						GitHub, Slack, Notion, or any server in the MCP ecosystem. Configure
						servers via environment variables and call any tool from your
						workflow.
					</p>
				</div>

				<CodeBlock
					code={`// Configure MCP servers via environment variables:
// MCP_SERVER_GITHUB=npx @modelcontextprotocol/server-github
// MCP_SERVER_FILESYSTEM=npx @modelcontextprotocol/server-filesystem /data

// Call any tool on a configured MCP server
const files = await step.mcp("list-files", {
  server: "filesystem",
  tool: "list_directory",
  args: { path: "/data/reports" },
})

// Create a GitHub issue from workflow analysis
await step.mcp("file-issue", {
  server: "github",
  tool: "create_issue",
  args: {
    repo: "myorg/myrepo",
    title: "Anomaly detected in swap volume",
    body: analysis.summary,
  },
})

// MCP results include content array and error flag
// result.content → [{ type: "text", text: "..." }]
// result.isError → false`}
				/>

				<SectionHeading id="querying-subgraphs">
					Querying subgraphs
				</SectionHeading>

				<div className="prose">
					<p>
						<code>step.query()</code> reads from your deployed subgraph tables
						directly. No API overhead — workflows run co-located with your data
						and query Postgres directly.
					</p>
				</div>

				<CodeBlock
					code={`// Query a subgraph table
const largeSwaps = await step.query("dex-swaps", "swaps", {
  where: {
    amount: { gte: "1000000000" },
    _blockHeight: { gte: event.block.height - 100 },
  },
  orderBy: { amount: "desc" },
  limit: 50,
})

// Aggregate queries
const volume = await step.count("dex-swaps", "swaps", {
  timestamp: { gte: oneDayAgo },
})

// Cross-subgraph correlation
const positions = await step.query("lending-positions", "borrows", {
  where: { borrower: { eq: event.sender } },
})
const prices = await step.query("price-feeds", "prices", {
  where: { token: { eq: positions[0]?.token } },
  orderBy: { _blockHeight: "desc" },
  limit: 1,
})`}
				/>

				<SectionHeading id="delivering-results">
					Delivering results
				</SectionHeading>

				<div className="prose">
					<p>
						<code>step.deliver()</code> sends results to external systems.
						Supports webhook, Slack, Discord, Telegram, and email. Deliveries
						are retried on failure and tracked in the run log.
					</p>
				</div>

				<CodeBlock
					code={`// Webhook delivery
await step.deliver("notify-backend", {
  type: "webhook",
  url: "https://api.example.com/events",
  body: { event: "whale_alert", data: analysis },
  headers: { "X-API-Key": process.env.API_KEY },
})

// Slack notification
await step.deliver("alert-team", {
  type: "slack",
  channel: "#alerts",
  text: \`Whale transfer detected: \${event.amount} microSTX from \${event.sender}\`,
})

// Email summary
await step.deliver("daily-report", {
  type: "email",
  to: "team@example.com",
  subject: "Daily DEX Volume Report",
  body: reportHtml,
})

// Discord notification
await step.deliver("notify-discord", {
  type: "discord",
  webhookUrl: "https://discord.com/api/webhooks/YOUR/WEBHOOK",
  content: "Whale transfer detected!",
  username: "Secondlayer Bot",
})

// Telegram message
await step.deliver("alert-telegram", {
  type: "telegram",
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: "-1001234567890",
  text: "⚠️ Large swap detected on DEX",
  parseMode: "HTML",
})`}
				/>

				<SectionHeading id="deploy">Deploy</SectionHeading>

				<div className="prose">
					<p>
						Deploy workflows via the CLI, the SDK, or directly from chat. The
						CLI bundles your handler through <code>@secondlayer/bundler</code>{" "}
						(esbuild with <code>@secondlayer/workflows</code> externalised),
						validates the definition, and POSTs the handler plus its original
						TypeScript source to <code>/api/workflows</code>. The server stores
						both — the compiled handler runs workflows, and the original source
						is what the chat edit loop reads from.
					</p>
					<p>
						Every update bumps the patch version automatically. Pass{" "}
						<code>expectedVersion</code> to opt into optimistic concurrency —
						the server returns <code>HTTP 409</code> with{" "}
						<code>{`{ currentVersion, expectedVersion }`}</code> when another
						deploy landed between your read and your write. Pass{" "}
						<code>dryRun: true</code> to validate the bundle without touching
						the database. Pass <code>clientRequestId</code> for idempotency —
						the API replays the previous response if the same id is seen twice
						within 30 seconds.
					</p>
				</div>

				<CodeBlock
					lang="bash"
					code={`# Deploy a workflow
sl workflows deploy workflows/whale-alert.ts

# Dev mode — watches for changes, auto-redeploys
sl workflows dev workflows/whale-alert.ts

# Deploy all workflows in a directory
sl workflows deploy workflows/`}
				/>

				<CodeBlock
					lang="typescript"
					code={`import { SecondLayer, VersionConflictError } from "@secondlayer/sdk"

const client = new SecondLayer({ apiKey: "sk-sl_...", origin: "cli" })

// Dry-run validation — no DB write, returns { valid, validation, bundleSize }
const check = await client.workflows.deploy({
  name: "whale-alert",
  trigger: { type: "event", filter: { type: "stx_transfer", minAmount: 100_000_000_000n } },
  handlerCode: bundledCode,
  dryRun: true,
})

// Real deploy with optimistic concurrency + idempotency
try {
  const result = await client.workflows.deploy({
    name: "whale-alert",
    trigger: { type: "event", filter: { type: "stx_transfer", minAmount: 100_000_000_000n } },
    handlerCode: bundledCode,
    sourceCode: tsSource,            // raw TypeScript — powers chat edits
    expectedVersion: "1.0.3",        // 409 if the stored version has moved
    clientRequestId: crypto.randomUUID(), // 30s dedupe window
  })
  console.log(result.version) // resolved on the server, e.g. "1.0.4"
} catch (err) {
  if (err instanceof VersionConflictError) {
    console.log("stale — current is", err.currentVersion)
  }
}`}
				/>

				<SectionHeading id="templates">Templates</SectionHeading>

				<div className="prose">
					<p>
						<code>@secondlayer/workflows/templates</code> ships six
						ready-to-deploy seeds you can fork from: <code>whale-alert</code>,{" "}
						<code>mint-watcher</code>, <code>price-circuit-breaker</code>,{" "}
						<code>daily-digest</code>, <code>failed-tx-alert</code>, and{" "}
						<code>health-cron</code>. Each template has a typed{" "}
						<code>{`{ id, name, description, category, trigger, code, prompt }`}</code>{" "}
						shape — the <code>code</code> field is the exact{" "}
						<code>defineWorkflow()</code> source, and <code>prompt</code> is the
						natural-language description agents use to match user intent. The
						chat and MCP tools list them automatically.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`import {
  templates,
  getTemplateById,
  getTemplatesByCategory,
} from "@secondlayer/workflows/templates"

// All six seeds
for (const t of templates) {
  console.log(t.id, t.trigger, t.category)
}

// Fork a template
const whaleAlert = getTemplateById("whale-alert")!
await client.workflows.deploy({
  name: "my-alert",
  trigger: { type: "event", filter: { type: "stx_transfer", minAmount: 50_000_000_000n } },
  handlerCode: bundle(whaleAlert.code),
  sourceCode: whaleAlert.code,
})`}
				/>

				<SectionHeading id="chat-authoring">Chat authoring</SectionHeading>

				<div className="prose">
					<p>
						The agent-native authoring loop runs end-to-end in chat, without
						leaving the browser. The user describes intent in natural language;
						the agent scaffolds a compilable skeleton, opens a Human-In-Loop
						deploy card, persists the source, and offers follow-up CTAs to
						trigger a test run or live-tail the run that just fired.
					</p>
					<p>
						Editing works the same way. The agent calls{" "}
						<code>read_workflow</code> to fetch the stored source and version,
						proposes a diff via <code>edit_workflow</code>, and the client
						renders a server-rendered unified diff card. Confirming re-runs the
						bundle + deploy path with <code>expectedVersion</code> so a stale
						edit 409s instead of clobbering someone else's write.
					</p>
					<p>
						<strong>In-flight-run semantics.</strong> Edits only apply to new
						runs. Any run already executing finishes on the bundle it was loaded
						with — the handler import is cache-busted per run, so the next
						trigger picks up the latest version. The chat instructions enforce
						this caveat on every confirm message.
					</p>
					<p>
						Chat session tools: <code>scaffold_workflow</code>,{" "}
						<code>deploy_workflow</code>, <code>read_workflow</code>,{" "}
						<code>edit_workflow</code>, <code>rollback_workflow</code>,{" "}
						<code>tail_workflow_run</code>, <code>list_workflow_templates</code>
						. MCP equivalents: <code>workflows_scaffold</code>,{" "}
						<code>workflows_deploy</code>, <code>workflows_get_definition</code>
						, <code>workflows_propose_edit</code>,{" "}
						<code>workflows_rollback</code>, <code>workflows_tail_run</code>,{" "}
						<code>workflows_template_list</code>,{" "}
						<code>workflows_template_get</code>,{" "}
						<code>workflows_pause_all</code>, <code>workflows_cancel_run</code>,{" "}
						<code>workflows_delete</code>.
					</p>
				</div>

				<SectionHeading id="versioning">
					Versioning &amp; rollback
				</SectionHeading>

				<div className="prose">
					<p>
						Every deploy bumps the stored workflow version by one patch digit
						(for example, <code>1.0.3</code> → <code>1.0.4</code>). Handler
						bundles are written to disk as{" "}
						<code>data/workflows/{`{name}-{version}`}.js</code>, so the runner
						can resolve a specific bundle for in-flight runs while the next
						trigger picks up the latest. The API retains the most recent three
						on-disk bundles per workflow; older versions are pruned on each
						deploy.
					</p>
					<p>
						Rollback copies a prior bundle forward as a brand-new patch version
						instead of mutating history — you always have an audit trail. Call{" "}
						<code>workflows.rollback(name, toVersion?)</code> from the SDK,{" "}
						<code>workflows_rollback</code> from MCP, or use{" "}
						<code>rollback_workflow</code> in chat. Omit <code>toVersion</code>{" "}
						to fall back to the immediate predecessor.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`// Roll whale-alert back to the previous on-disk bundle
const result = await client.workflows.rollback("whale-alert")
// => { action: "rolled-back", fromVersion: "1.0.4", restoredFromVersion: "1.0.3", version: "1.0.5" }

// Roll back to a specific retained version
await client.workflows.rollback("whale-alert", "1.0.2")`}
				/>

				<SectionHeading id="live-tail">Live tail</SectionHeading>

				<div className="prose">
					<p>
						Follow an in-flight run in real time via server-sent events. The SDK
						exposes{" "}
						<code>workflows.streamRun(name, runId, onEvent, signal)</code> — it
						opens a streaming <code>fetch</code> against{" "}
						<code>GET /api/workflows/:name/runs/:runId/stream</code>, parses SSE
						events, and invokes your callback with a typed{" "}
						<code>WorkflowTailEvent</code> union. The stream emits a{" "}
						<code>step</code> event when a step changes state, a{" "}
						<code>done</code> event when the run finishes, periodic{" "}
						<code>heartbeat</code> events, and a <code>timeout</code> event
						after 30 minutes. <code>streamRun</code> resolves cleanly on{" "}
						<code>done</code> or <code>timeout</code>, or when the abort signal
						fires.
					</p>
					<p>
						The MCP <code>workflows_tail_run</code> tool wraps the same stream
						and returns a bounded log (it collects up to <code>limit</code>{" "}
						events or until the run completes) — MCP is not streaming-first, so
						this is a collect-and-return, not a live transport.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`const controller = new AbortController()
await client.workflows.streamRun("whale-alert", runId, (event) => {
  switch (event.type) {
    case "step":
      console.log(\`\${event.step.stepId} -> \${event.step.status}\`)
      break
    case "done":
      console.log(\`run \${event.done.runId} \${event.done.status}\`)
      break
    case "timeout":
      console.warn(event.message)
      break
  }
}, controller.signal)`}
				/>

				<SectionHeading id="management">Management</SectionHeading>

				<div className="prose">
					<p>
						Manage workflows via the SDK or CLI. Each run is tracked with full
						step-level logs, timing, and AI token usage.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`import { SecondLayer } from "@secondlayer/sdk"

const client = new SecondLayer({ apiKey: "sk-sl_...", origin: "cli" })

// List workflows
const { workflows } = await client.workflows.list()

// Get workflow detail
const workflow = await client.workflows.get("whale-alert")

// Read the stored TypeScript source (or a read-only notice for pre-capture rows)
const source = await client.workflows.getSource("whale-alert")
if (source.readOnly) {
  console.log(source.reason) // "deployed before source-capture — redeploy to enable chat edits"
}

// List runs
const { runs } = await client.workflows.listRuns("whale-alert", {
  status: "completed",
  limit: 25,
})

// Get run detail — includes step-level logs and timing
const run = await client.workflows.getRun(runId)

// Trigger a manual workflow
const { runId } = await client.workflows.trigger("contract-analyzer", {
  contractId: "SP1234...::my-contract",
  depth: "deep",
})

// Pause / resume a single workflow
await client.workflows.pause("whale-alert")
await client.workflows.resume("whale-alert")

// Bulk pause every active workflow in the account
const { paused, workflows: affected } = await client.workflows.pauseAll()

// Cancel an in-flight run
await client.workflows.cancelRun(runId)

// Delete
await client.workflows.delete("whale-alert")`}
				/>

				<CodeBlock
					lang="bash"
					code={`# CLI equivalents
sl workflows ls
sl workflows get whale-alert
sl workflows runs whale-alert --status completed
sl workflows trigger contract-analyzer --input '{"contractId": "SP1234..."}'
sl workflows pause whale-alert
sl workflows delete whale-alert`}
				/>

				<div className="prose">
					<p>
						The optional <code>origin</code> constructor option marks every
						request with <code>x-sl-origin: cli | mcp | session</code>. The
						server logs it alongside every deploy event so you can slice
						telemetry by surface — who is deploying from a terminal, who is
						deploying from a chat session, and who is deploying through MCP. The
						default is <code>cli</code>.
					</p>
				</div>

				<SectionHeading id="props">Props</SectionHeading>

				<div className="props-section">
					<div className="props-group-title">defineWorkflow</div>

					<div className="prop-row">
						<span className="prop-name">name</span>
						<span className="prop-type">string</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">trigger</span>
						<span className="prop-type">
							EventTrigger | StreamTrigger | ScheduleTrigger | ManualTrigger
						</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">handler</span>
						<span className="prop-type">
							(ctx: WorkflowContext) =&gt; Promise&lt;any&gt;
						</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">retries</span>
						<span className="prop-type">RetryConfig</span>
						<span className="prop-default">3 attempts, 1s backoff</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">timeout</span>
						<span className="prop-type">number</span>
						<span className="prop-default">300000 (5 min)</span>
					</div>

					<div className="props-group-title">Trigger types</div>

					<div className="prop-row">
						<span className="prop-name">event</span>
						<span className="prop-type">
							filter: SubgraphFilter (same 13 types as streams)
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">stream</span>
						<span className="prop-type">
							filter: SubgraphFilter (fires workflow directly, no webhook)
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">schedule</span>
						<span className="prop-type">cron: string, timezone?: string</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">manual</span>
						<span className="prop-type">
							input?: Record&lt;string, InputField&gt;
						</span>
					</div>

					<div className="props-group-title">Step primitives</div>

					<div className="prop-row">
						<span className="prop-name">step.run(id, fn)</span>
						<span className="prop-type">
							Isolated unit of work. Retries independently.
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">step.ai(id, opts)</span>
						<span className="prop-type">
							LLM analysis. Supports schema for structured output.
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">step.query(subgraph, table, opts)</span>
						<span className="prop-type">
							Direct Postgres query against subgraph tables.
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">
							step.count(subgraph, table, where)
						</span>
						<span className="prop-type">
							Row count against subgraph tables.
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">step.deliver(id, opts)</span>
						<span className="prop-type">
							Send results via webhook, Slack, Discord, Telegram, or email.
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">step.sleep(id, ms)</span>
						<span className="prop-type">Pause execution for a duration.</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">step.invoke(id, opts)</span>
						<span className="prop-type">
							Trigger another workflow and await its result.
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">step.mcp(id, opts)</span>
						<span className="prop-type">
							Call a tool on an external MCP server.
						</span>
					</div>

					<div className="props-group-title">step.ai options</div>

					<div className="prop-row">
						<span className="prop-name">prompt</span>
						<span className="prop-type">string</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">model</span>
						<span className="prop-type">
							&apos;haiku&apos; | &apos;sonnet&apos;
						</span>
						<span className="prop-default">haiku</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">schema</span>
						<span className="prop-type">Record&lt;string, SchemaField&gt;</span>
					</div>

					<div className="props-group-title">step.mcp options</div>

					<div className="prop-row">
						<span className="prop-name">server</span>
						<span className="prop-type">string</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">tool</span>
						<span className="prop-type">string</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">args</span>
						<span className="prop-type">Record&lt;string, unknown&gt;</span>
					</div>

					<div className="props-group-title">step.deliver targets</div>

					<div className="prop-row">
						<span className="prop-name">webhook</span>
						<span className="prop-type">url, body, headers?</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">slack</span>
						<span className="prop-type">channel, text</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">email</span>
						<span className="prop-type">to, subject, body</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">discord</span>
						<span className="prop-type">
							webhookUrl, content, username?, avatarUrl?
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">telegram</span>
						<span className="prop-type">
							botToken, chatId, text, parseMode?
						</span>
					</div>

					<div className="props-group-title">SDK — Workflows client</div>

					<div className="prop-row">
						<span className="prop-name">deploy(data)</span>
						<span className="prop-type">
							Promise&lt;DeployResponse&gt; — overloaded: returns
							DeployDryRunResponse when <code>dryRun: true</code>
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
						<span className="prop-name">getSource(name)</span>
						<span className="prop-type">
							Promise&lt;WorkflowSource&gt; — readOnly: true when source
							isn&apos;t captured
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">rollback(name, toVersion?)</span>
						<span className="prop-type">
							Restore a prior on-disk bundle as a new patch version
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">pauseAll()</span>
						<span className="prop-type">
							Pause every active workflow for the authenticated account
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">cancelRun(runId)</span>
						<span className="prop-type">
							Cancel a running / pending run and drop its queue entry
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">
							streamRun(name, runId, onEvent, signal?)
						</span>
						<span className="prop-type">
							SSE tail, resolves on done / timeout / abort
						</span>
					</div>

					<div className="props-group-title">VersionConflictError</div>

					<div className="prop-row">
						<span className="prop-name">extends</span>
						<span className="prop-type">ApiError (status 409)</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">currentVersion</span>
						<span className="prop-type">string</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">expectedVersion</span>
						<span className="prop-type">string</span>
					</div>

					<div className="props-group-title">WorkflowSource</div>

					<div className="prop-row">
						<span className="prop-name">name</span>
						<span className="prop-type">string</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">version</span>
						<span className="prop-type">string</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">sourceCode</span>
						<span className="prop-type">string | null</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">readOnly</span>
						<span className="prop-type">boolean</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">reason</span>
						<span className="prop-type">string (when readOnly)</span>
					</div>

					<div className="props-group-title">WorkflowTailEvent</div>

					<div className="prop-row">
						<span className="prop-name">type</span>
						<span className="prop-type">
							&apos;step&apos; | &apos;done&apos; | &apos;heartbeat&apos; |
							&apos;timeout&apos;
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">step</span>
						<span className="prop-type">
							WorkflowStepEvent — id, stepId, stepType, status, output?, error?,
							ts
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">done</span>
						<span className="prop-type">
							{"{"} runId, status, error?, completedAt? {"}"}
						</span>
					</div>

					<div className="props-group-title">WorkflowRun</div>

					<div className="prop-row">
						<span className="prop-name">id</span>
						<span className="prop-type">string</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">workflowName</span>
						<span className="prop-type">string</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">status</span>
						<span className="prop-type">
							&apos;running&apos; | &apos;completed&apos; | &apos;failed&apos; |
							&apos;cancelled&apos;
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">steps</span>
						<span className="prop-type">StepResult[]</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">duration</span>
						<span className="prop-type">number (ms)</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">aiTokensUsed</span>
						<span className="prop-type">number</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">triggeredAt</span>
						<span className="prop-type">string</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">completedAt</span>
						<span className="prop-type">string | null</span>
					</div>
				</div>
			</main>
		</div>
	);
}
