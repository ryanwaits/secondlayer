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
	{ label: "Querying subgraphs", href: "#querying-subgraphs" },
	{ label: "Delivering results", href: "#delivering-results" },
	{ label: "Deploy", href: "#deploy" },
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
						schedule, or fire on demand — secondlayer handles execution, retries,
						and observability. Each step runs independently and retries on
						failure without re-running earlier steps.
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
						A workflow has two parts: a trigger (when to run) and a handler (what
						to do). Handlers are built from steps — isolated units of work that
						retry independently and memoize results across failures.
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
						triggers use cron expressions. Manual triggers accept typed input via
						the API or dashboard.
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
						without re-running completed steps. Use{" "}
						<code>Promise.all()</code> for parallel execution.
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
							A complete pipeline — detect large swaps, enrich with subgraph
							data, run AI analysis, and alert via Slack:
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
						output. AI evaluations count toward your tier&apos;s daily throughput
						— when the cap is reached, AI steps are skipped and the workflow
						continues with condition-only logic.
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
						Supports webhook, Slack, and email. Deliveries are retried on failure
						and tracked in the run log.
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
})`}
				/>

				<SectionHeading id="deploy">Deploy</SectionHeading>

				<div className="prose">
					<p>
						Deploy workflows via the CLI. The CLI bundles your handler code and
						registers triggers with the platform. Workflows start running
						immediately after deploy.
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

const client = new SecondLayer({ apiKey: "sk-sl_..." })

// List workflows
const { workflows } = await client.workflows.list()

// Get workflow detail
const workflow = await client.workflows.get("whale-alert")

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

// Pause / resume
await client.workflows.pause("whale-alert")
await client.workflows.resume("whale-alert")

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
						<span className="prop-type">EventTrigger | ScheduleTrigger | ManualTrigger</span>
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
						<span className="prop-name">step.count(subgraph, table, where)</span>
						<span className="prop-type">
							Row count against subgraph tables.
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">step.deliver(id, opts)</span>
						<span className="prop-type">
							Send results via webhook, Slack, or email.
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">step.sleep(id, ms)</span>
						<span className="prop-type">
							Pause execution for a duration.
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">step.invoke(id, opts)</span>
						<span className="prop-type">
							Trigger another workflow and await its result.
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

					<div className="props-group-title">WorkflowRun</div>

					<div className="prop-row">
						<span className="prop-name">id</span>
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
