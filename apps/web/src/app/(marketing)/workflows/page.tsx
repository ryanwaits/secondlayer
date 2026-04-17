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
	{ label: "Delivering results", href: "#delivering-results" },
	{ label: "Deploy", href: "#deploy" },
];

export default function WorkflowsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Workflows" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">
						Workflows <BoxBadge>Beta</BoxBadge>
					</h1>
				</header>

				<div className="prose">
					<p>
						Code that runs when things happen. Trigger on blockchain events, a
						schedule, or on demand — then write steps that call AI, use MCP
						tools, query <a href="/subgraphs">subgraph</a> data, hit external
						APIs, or deliver to webhooks, Slack, email, and more.
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
						that retry independently. Use <code>step.ai()</code> for LLM
						analysis, <code>step.query()</code> to read from{" "}
						<a href="/subgraphs">subgraphs</a>, and <code>step.deliver()</code>{" "}
						to send results anywhere.
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
    const analysis = await step.ai("assess-risk", {
      prompt: \`Whale transfer of \${event.amount} microSTX from \${event.sender}. Unusual?\`,
      schema: {
        riskScore: { type: "number", description: "0-1 risk score" },
        summary: { type: "string" },
      },
    })

    if (analysis.riskScore > 0.7) {
      await step.deliver("alert", {
        type: "webhook",
        url: "https://api.example.com/alerts",
        body: { transfer: event, analysis },
      })
    }
  },
})`}
				/>

				<SectionHeading id="triggers">Triggers</SectionHeading>

				<div className="prose">
					<p>
						Three trigger types. Event triggers fire directly when a block
						matches a filter — no webhook needed. Schedule triggers use cron
						expressions. Manual triggers accept typed input via the API or
						dashboard.
					</p>
				</div>

				<CodeBlock
					code={`// Trigger on blockchain events
trigger: {
  type: "event",
  filter: { type: "stx_transfer", minAmount: 50_000_000_000 },
}

// Trigger on a schedule
trigger: {
  type: "schedule",
  cron: "0 8 * * *",
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
						Each <code>step.run()</code> is isolated — retries on failure
						without re-running completed steps. Use <code>Promise.all()</code>{" "}
						for parallel execution.
					</p>
				</div>

				<CodeBlock
					code={`handler: async ({ event, step }) => {
  // Sequential
  const data = await step.run("fetch", async () => {
    return await fetchFromAPI(event.contractId)
  })

  // Parallel
  const [analysis, history] = await Promise.all([
    step.run("analyze", async () => analyzePatterns(data)),
    step.run("history", async () => getHistoricalData(data)),
  ])
}`}
				/>

				<SectionHeading id="delivering-results">
					Delivering results
				</SectionHeading>

				<div className="prose">
					<p>
						<code>step.deliver()</code> sends to webhooks (HMAC-signed, retried
						on failure), Slack, Discord, Telegram, or email. Every delivery is
						tracked in the run log.
					</p>
				</div>

				<CodeBlock
					code={`// Webhook
await step.deliver("notify", {
  type: "webhook",
  url: "https://api.example.com/events",
  body: { event, analysis },
  headers: { "X-API-Key": process.env.API_KEY },
})

// Slack
await step.deliver("alert-team", {
  type: "slack",
  channel: "#alerts",
  text: \`Whale transfer: \${event.amount} microSTX from \${event.sender}\`,
})`}
				/>

				<SectionHeading id="deploy">Deploy</SectionHeading>

				<CodeBlock
					lang="bash"
					code={`# Deploy a workflow
sl workflows deploy workflows/whale-alert.ts

# Dev mode — watches for changes, auto-redeploys
sl workflows dev workflows/whale-alert.ts

# Trigger a run
sl workflows trigger whale-alert

# View run history
sl workflows runs whale-alert

# Pause / resume / delete
sl workflows pause whale-alert
sl workflows delete whale-alert`}
				/>
			</main>
		</div>
	);
}
