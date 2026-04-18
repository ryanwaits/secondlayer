/**
 * Agent prompts used across platform + marketing touchpoints.
 *
 * Structure: product explainer -> idempotent setup -> /secondlayer skill invocation
 */

const SUBGRAPHS_INTRO =
	"Subgraphs are declarative SQL tables that auto-index blockchain activity into queryable Postgres tables. Define a schema, write event handlers in TypeScript, deploy, and query — like a materialized view over the chain.";

const SETUP = `Ensure setup (skip any step already done, use the project's package manager):
- Skill: run the \`skills\` npm package to install — e.g. \`npx|bunx|pnpm dlx skills add ryanwaits/secondlayer --skill secondlayer -y\`
- CLI: \`@secondlayer/cli\` installed globally
- Auth: \`secondlayer auth login\``;

// ── Platform empty states (collapsible code blocks) ──────────────

export const SUBGRAPHS_EMPTY_PROMPT = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Help me create a subgraph. Ask me:
1. What contract do I want to index?
2. Which events or function calls should I track?
3. What columns do I need in my tables?

Scaffold the subgraph, let me review it, then deploy.`;

// ── Dashboard quick-action cards (short, single-task) ────────────

export const QUICK_SUBGRAPH_PROMPT = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Scaffold a subgraph that indexes swap events from the ALEX DEX contract SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01 and deploy it.`;

// ── Action dropdown items (data states) ──────────────────────────

export const DROPDOWN_DEPLOY_SUBGRAPH = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Scaffold and deploy a new subgraph. Ask me what contract and events to index.`;

// ── Dashboard get-started (agent tab) ────────────────────────────

export const DASHBOARD_SUBGRAPHS_PROMPT = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Help me create a subgraph. Ask me:
1. What contract do I want to index?
2. Which events or function calls should I track?
3. What columns do I need in my tables?

Scaffold the subgraph, let me review it, then deploy.`;

// ── Workflows ───────────────────────────────────────────────────

const WORKFLOWS_INTRO =
	"Workflows automate intelligence on your onchain data. Define multi-step tasks that trigger on blockchain events, run on a schedule, or fire on demand. Each step runs independently with automatic retries and memoization. Available step methods: step.generateObject() and step.generateText() for AI SDK v6 structured output + tool-calling, step.render() to produce catalog-validated UI, step.query() to read subgraph data, step.deliver() to send to webhooks/Slack/Discord/Telegram/email, step.invoke() to chain workflows, step.sleep() for delays, and step.run() for anything else.";

export const WORKFLOWS_EMPTY_PROMPT = `${WORKFLOWS_INTRO}

${SETUP}

/secondlayer Help me create a workflow. Ask me:
1. What should trigger this workflow? (blockchain event, schedule, or manual)
2. What data do I need to read or analyze?
3. What action should it take? (webhook, Slack, email)

Create the workflow and deploy it.`;

export const QUICK_WORKFLOW_PROMPT = `${WORKFLOWS_INTRO}

${SETUP}

/secondlayer Create a workflow that monitors STX transfers over 100K STX, runs AI analysis on the transfer pattern, and sends a Slack alert to #whale-alerts.`;

export const DROPDOWN_CREATE_WORKFLOW = `${WORKFLOWS_INTRO}

${SETUP}

/secondlayer Create a new workflow. Ask me what it should monitor and what action to take.`;

// ── Marketing docs (below intro prose) ───────────────────────────

export const MARKETING_SUBGRAPHS_PROMPT = SUBGRAPHS_EMPTY_PROMPT;

export const MARKETING_WORKFLOWS_PROMPT = WORKFLOWS_EMPTY_PROMPT;
