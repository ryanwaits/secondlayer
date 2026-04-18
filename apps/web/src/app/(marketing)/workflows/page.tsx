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
	{ label: "Tools", href: "#tools" },
	{ label: "Catalogs", href: "#catalogs" },
	{ label: "Deploy", href: "#deploy" },
	{ label: "Broadcast", href: "#broadcast" },
	{ label: "Budgets", href: "#budgets" },
	{ label: "Migrating from v1", href: "#migrating" },
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
						Code that runs when things happen. Trigger on typed blockchain
						events, a schedule, or on demand — then compose steps that generate
						structured output, run tool-calling agent loops, render UI, query{" "}
						<a href="/subgraphs">subgraph</a> data, and deliver results
						anywhere.
					</p>
					<p>
						Install with <code>bun add @secondlayer/workflows</code>. Chain
						helpers live on <code>@secondlayer/stacks</code> subpaths.
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
						(what to do). Steps run independently and retry on failure without
						re-running completed work. Typed triggers from{" "}
						<code>@secondlayer/stacks/triggers</code> narrow the handler's{" "}
						<code>event</code> parameter — no casting.
					</p>
				</div>

				<CodeBlock
					code={`import { defineWorkflow, tool } from "@secondlayer/workflows"
import { on } from "@secondlayer/stacks/triggers"
import { getStxBalance, bnsReverse } from "@secondlayer/stacks/tools"
import { defineCatalog, AddressProps, AmountProps } from "@secondlayer/stacks/ui/schemas"
import { anthropic } from "@ai-sdk/anthropic"
import { z } from "zod"

const whaleUI = defineCatalog({
  components: {
    Address: { props: AddressProps },
    Amount:  { props: AmountProps },
    WhaleCard: {
      props: z.object({ summary: z.string(), risk: z.number() }),
    },
  },
  actions: {},
})

export default defineWorkflow({
  name: "whale-alert",
  trigger: on.stxTransfer({ minAmount: 100_000_000_000n }),
  handler: async ({ event, step }) => {
    // event: { sender, recipient, amount: bigint, memo, tx } — inferred
    const enrich = await step.generateText("enrich", {
      model: anthropic("claude-sonnet-4-6"),
      tools: { getStxBalance, bnsReverse },
      prompt: \`Assess this whale transfer: \${event.amount} uSTX from \${event.sender} to \${event.recipient}. Look up balances and BNS names. Return a one-sentence risk summary.\`,
    })

    const card = await step.render("card", whaleUI, {
      model: anthropic("claude-sonnet-4-6"),
      prompt: "Render a whale card with risk + summary.",
      context: { enrich: enrich.text, event },
    })

    await step.deliver("slack", {
      type: "slack",
      channel: "#whale-alerts",
      text: \`Whale: \${event.amount} uSTX — \${enrich.text}\`,
    })

    return { spec: card.spec }
  },
})`}
				/>

				<SectionHeading id="triggers">Triggers</SectionHeading>

				<div className="prose">
					<p>
						Event, schedule, or manual. Typed <code>on.*</code> helpers from{" "}
						<code>@secondlayer/stacks/triggers</code> infer the handler event
						payload. 13 helpers total: <code>stxTransfer</code>,{" "}
						<code>stxMint</code>, <code>stxBurn</code>, <code>stxLock</code>,{" "}
						<code>ftTransfer</code>, <code>ftMint</code>, <code>ftBurn</code>,{" "}
						<code>nftTransfer</code>, <code>nftMint</code>, <code>nftBurn</code>
						, <code>contractCall</code>, <code>contractDeploy</code>,{" "}
						<code>printEvent</code>.
					</p>
				</div>

				<CodeBlock
					code={`import { on } from "@secondlayer/stacks/triggers"

// Typed event — event: StxTransferEvent
trigger: on.stxTransfer({ minAmount: 50_000_000_000n })

// Typed contract call — event: ContractCallEvent
trigger: on.contractCall({
  contractId: "SP2C2YFP12AJZB1MAERTSVAR6NQJHQ5MEH0GH33C.usda-token",
  functionName: "transfer",
})

// Schedule
trigger: {
  type: "schedule",
  cron: "0 8 * * *",
  timezone: "America/Chicago",
}

// Manual — typed input via API or dashboard
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
						Five primitives cover most workflows. Each step is isolated — on
						retry, completed steps (including tool calls inside{" "}
						<code>generateText</code>) serve from cache.
					</p>
				</div>

				<div className="prose">
					<p>
						<code>step.run</code> — arbitrary async work.
					</p>
				</div>

				<CodeBlock
					code={`const data = await step.run("fetch", async () => {
  const res = await fetch(\`https://api.example.com/tx/\${event.tx.txId}\`)
  return res.json()
})

// Parallel
const [a, b] = await Promise.all([
  step.run("a", async () => loadA()),
  step.run("b", async () => loadB()),
])`}
				/>

				<div className="prose">
					<p>
						<code>step.generateObject</code> — Zod-schemaed structured output,
						any AI SDK v6 provider.
					</p>
				</div>

				<CodeBlock
					code={`import { z } from "zod"
import { anthropic } from "@ai-sdk/anthropic"

const { object, usage } = await step.generateObject("assess", {
  model: anthropic("claude-sonnet-4-6"),
  schema: z.object({
    riskScore: z.number().min(0).max(1),
    summary: z.string(),
    tags: z.array(z.string()),
  }),
  prompt: \`Whale transfer of \${event.amount} uSTX from \${event.sender}.\`,
})

if (object.riskScore > 0.7) { /* ... */ }`}
				/>

				<div className="prose">
					<p>
						<code>step.generateText</code> — tool-calling agent loop. Returns{" "}
						<code>{"{ text, toolCalls, steps, usage }"}</code>. Tool calls
						persist as child steps and memoize on parent retry.
					</p>
				</div>

				<CodeBlock
					code={`import { getStxBalance, bnsReverse, readContract } from "@secondlayer/stacks/tools"

const { text, toolCalls } = await step.generateText("enrich", {
  model: anthropic("claude-sonnet-4-6"),
  tools: { getStxBalance, bnsReverse, readContract },
  maxSteps: 5,
  prompt: \`Resolve \${event.sender} to a BNS name and report their STX balance.\`,
})`}
				/>

				<div className="prose">
					<p>
						<code>step.render</code> — AI generates a catalog-validated UI spec.
						The runner validates against the catalog and returns{" "}
						<code>{"{ spec, usage }"}</code>. Specs auto-render in the workflow
						run detail dashboard.
					</p>
				</div>

				<CodeBlock
					code={`const { spec } = await step.render("card", whaleUI, {
  model: anthropic("claude-sonnet-4-6"),
  prompt: "Render a whale transfer card.",
  context: { event, analysis: object },
})`}
				/>

				<div className="prose">
					<p>
						<code>step.deliver</code> — send to webhooks (HMAC-signed, retried),
						Slack, Discord, Telegram, or email. Every delivery is tracked in the
						run log.
					</p>
				</div>

				<CodeBlock
					code={`await step.deliver("webhook", {
  type: "webhook",
  url: "https://api.example.com/events",
  body: { event, analysis: object },
  headers: { "X-API-Key": process.env.API_KEY },
})

await step.deliver("slack", {
  type: "slack",
  channel: "#alerts",
  text: \`Whale: \${event.amount} uSTX from \${event.sender}\`,
})`}
				/>

				<SectionHeading id="broadcast">Broadcast</SectionHeading>

				<div className="prose">
					<p>
						Submit signed transactions via a workflow-declared signer.
						Secondlayer never holds keys — the runner POSTs unsigned tx +
						context to your HTTPS endpoint with an HMAC-signed body; your
						service signs and returns. Ship the reference implementation from{" "}
						<code>@secondlayer/signer-node</code> on Railway/Fly/Hetzner.
					</p>
				</div>

				<CodeBlock
					code={`import { defineWorkflow, signer } from "@secondlayer/workflows"
import { broadcast, tx } from "@secondlayer/stacks"

export default defineWorkflow({
  name: "dca",
  trigger: { type: "schedule", cron: "0 */6 * * *" },
  signers: {
    treasury: signer.remote({
      endpoint:  "https://signer.acme.com/sign",
      publicKey: "03fae8…",
      hmacRef:   "treasury",  // sl secrets set treasury <hmac>
    }),
  },
  handler: async ({ step }) => {
    await step.run("pay", () =>
      broadcast(
        tx.transfer({ recipient: "SP…", amount: 1_000_000n }),
        { signer: "treasury", awaitConfirmation: true,
          maxMicroStx: 50_000_000n, maxFee: 5_000n },
      ),
    )
  },
})`}
				/>

				<div className="prose">
					<p>
						<code>awaitConfirmation: true</code> blocks until the indexer sees
						the tx confirmed on-chain (120s timeout). Rotate the signer's HMAC
						without redeploying via <code>sl secrets rotate treasury</code>.
					</p>
				</div>

				<SectionHeading id="budgets">Budgets</SectionHeading>

				<div className="prose">
					<p>
						Per-workflow caps on AI spend, chain spend, and step count. On
						exceed, pause the workflow (default), fire a delivery alert, or
						continue silently. Counters reset daily/weekly; paused workflows
						auto-resume at the boundary.
					</p>
				</div>

				<CodeBlock
					code={`export default defineWorkflow({
  name: "capped-dca",
  trigger: { type: "schedule", cron: "0 */6 * * *" },
  budget: {
    ai:    { maxUsd: 5, maxTokens: 1_000_000 },
    chain: { maxMicroStx: 100_000_000n, maxTxCount: 10 },
    run:   { maxSteps: 50, maxDurationMs: 60_000 },
    reset: "daily",
    onExceed: "pause",
  },
  handler: async ({ step }) => { /* ... */ },
})`}
				/>

				<SectionHeading id="tools">Tools</SectionHeading>

				<div className="prose">
					<p>
						<code>@secondlayer/stacks/tools</code> ships AI SDK v6{" "}
						<code>tool()</code> wrappers ready to drop into{" "}
						<code>step.generateText</code>: <code>getStxBalance</code>,{" "}
						<code>getAccountInfo</code>, <code>getBlock</code>,{" "}
						<code>getBlockHeight</code>, <code>readContract</code>,{" "}
						<code>estimateFee</code>, <code>bnsResolve</code>,{" "}
						<code>bnsReverse</code>, <code>getTransaction</code>,{" "}
						<code>getAccountHistory</code>, <code>getMempoolStats</code>,{" "}
						<code>getNftHoldings</code>. Bare exports use{" "}
						<code>STACKS_RPC_URL</code>; the factory binds a custom client.
					</p>
					<p>
						Bitcoin reads live at <code>@secondlayer/stacks/tools/btc</code>:{" "}
						<code>btcConfirmations</code>, <code>btcBalance</code>,{" "}
						<code>btcUtxos</code>, <code>btcFeeEstimate</code>,{" "}
						<code>btcBlockHeight</code>.
					</p>
				</div>

				<CodeBlock
					code={`// Bare exports — uses STACKS_RPC_URL env
import { getStxBalance, bnsReverse } from "@secondlayer/stacks/tools"
import { btcBalance, btcConfirmations } from "@secondlayer/stacks/tools/btc"

await step.generateText("enrich", {
  model: anthropic("claude-sonnet-4-6"),
  tools: { getStxBalance, bnsReverse, btcBalance, btcConfirmations },
  prompt: "...",
})

// Factory — bind a custom client (e.g. testnet)
import { createPublicClient, http, testnet } from "@secondlayer/stacks"
import { createStacksTools } from "@secondlayer/stacks/tools"

const stacks = createStacksTools(
  createPublicClient({ chain: testnet, transport: http() }),
)

await step.generateText("enrich", {
  model: anthropic("claude-sonnet-4-6"),
  tools: stacks,
  prompt: "...",
})`}
				/>

				<SectionHeading id="catalogs">Catalogs</SectionHeading>

				<div className="prose">
					<p>
						A catalog is a plain object:{" "}
						<code>{"{ components, actions }"}</code> where each component maps
						to a Zod prop schema. <code>step.render</code> asks the model to
						pick one and emit props that validate — the runner enforces the
						schema. <code>@secondlayer/stacks/ui/schemas</code> ships React-free
						atom schemas (<code>AddressProps</code>, <code>AmountProps</code>,{" "}
						<code>BlockHeightProps</code>, <code>BnsNameProps</code>,{" "}
						<code>NftAssetProps</code>, <code>PrincipalProps</code>,{" "}
						<code>TokenProps</code>, <code>TxStatusProps</code>) that the
						dashboard knows how to render.
					</p>
				</div>

				<CodeBlock
					code={`import { defineCatalog, AddressProps, AmountProps, TxStatusProps } from "@secondlayer/stacks/ui/schemas"
import { z } from "zod"

const transferCard = defineCatalog({
  components: {
    Address:  { props: AddressProps },
    Amount:   { props: AmountProps },
    TxStatus: { props: TxStatusProps },
    Summary:  { props: z.object({ title: z.string(), body: z.string() }) },
  },
  actions: {},
})

const { spec } = await step.render("card", transferCard, {
  model: anthropic("claude-sonnet-4-6"),
  prompt: "Render a transfer summary with tx status.",
  context: { event },
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

				<SectionHeading id="migrating">Migrating from v1</SectionHeading>

				<div className="prose">
					<p>
						<code>step.ai</code> still works as a shim over{" "}
						<code>step.generateObject</code> and logs a deprecation. Migrate at
						leisure — move the <code>SchemaField</code> DSL to a Zod schema,
						pass an AI SDK v6 model, and any provider works.{" "}
						<code>step.mcp</code> is gone in v2; use AI SDK v6's MCP client
						inside <code>step.generateText</code> tools instead.
					</p>
				</div>
			</main>
		</div>
	);
}
