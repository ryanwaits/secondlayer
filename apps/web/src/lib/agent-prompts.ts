/**
 * Agent prompts used across platform + marketing touchpoints.
 *
 * Structure: product explainer -> idempotent setup -> /secondlayer skill invocation
 */

const STREAMS_INTRO = "Streams deliver matching on-chain events (transfers, contract calls, mints, etc.) to your endpoint as each block is processed. Define filters, point at a URL, and secondlayer handles the rest. Delivery is at-least-once.";

const SUBGRAPHS_INTRO = "Subgraphs are declarative SQL tables that auto-index blockchain activity into queryable Postgres tables. Define a schema, write event handlers in TypeScript, deploy, and query — like a materialized view over the chain.";

const SETUP = `Ensure setup (skip any step already done, use the project's package manager):
- Skill: run the \`skills\` npm package to install — e.g. \`npx|bunx|pnpm dlx skills add ryanwaits/secondlayer --skill secondlayer -y\`
- CLI: \`@secondlayer/cli\` installed globally
- Auth: \`secondlayer auth login\``;

// ── Platform empty states (collapsible code blocks) ──────────────

export const STREAMS_EMPTY_PROMPT = `${STREAMS_INTRO}

${SETUP}

/secondlayer Help me create a stream. Ask me:
1. What blockchain events do I want to track?
2. Where should deliveries be sent (endpoint URL)?
3. Any filter constraints (contract, sender, amount)?

Create the stream config and register it.`;

export const SUBGRAPHS_EMPTY_PROMPT = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Help me create a subgraph. Ask me:
1. What contract do I want to index?
2. Which events or function calls should I track?
3. What columns do I need in my tables?

Scaffold the subgraph, let me review it, then deploy.`;

// ── Dashboard quick-action cards (short, single-task) ────────────

export const QUICK_STREAM_PROMPT = `${STREAMS_INTRO}

${SETUP}

/secondlayer Create a stream that watches for STX transfer events over 100 STX and sends them to my endpoint at https://example.com/events.`;

export const QUICK_SUBGRAPH_PROMPT = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Scaffold a subgraph that indexes swap events from the ALEX DEX contract SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01 and deploy it.`;

// ── Action dropdown items (data states) ──────────────────────────

export const DROPDOWN_CREATE_STREAM = `${STREAMS_INTRO}

${SETUP}

/secondlayer Create a new stream. Ask me what events to track and where to send them.`;

export const DROPDOWN_DEPLOY_SUBGRAPH = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Scaffold and deploy a new subgraph. Ask me what contract and events to index.`;

// ── Dashboard get-started (agent tab) ────────────────────────────

export const DASHBOARD_BOTH_PROMPT = `${STREAMS_INTRO}

${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Help me get started. Ask me:
1. Do I want to create a stream (real-time delivery) or a subgraph (custom indexer)?
2. What blockchain events should it track?
3. What's my endpoint URL or what tables do I need?

Set everything up and walk me through it.`;

export const DASHBOARD_STREAMS_PROMPT = `${STREAMS_INTRO}

${SETUP}

/secondlayer Help me create a stream. Ask me:
1. What blockchain events do I want to track?
2. Where should deliveries be sent (endpoint URL)?
3. Any filter constraints (contract, sender, amount)?

Create the stream config and register it.`;

export const DASHBOARD_SUBGRAPHS_PROMPT = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Help me create a subgraph. Ask me:
1. What contract do I want to index?
2. Which events or function calls should I track?
3. What columns do I need in my tables?

Scaffold the subgraph, let me review it, then deploy.`;

// ── Workflows ───────────────────────────────────────────────────

const WORKFLOWS_INTRO = "Workflows automate intelligence on your onchain data. Define multi-step tasks that trigger on blockchain events, run on a schedule, or fire on demand. Each step runs independently with automatic retries. Use step.ai() for LLM analysis and step.query() to read subgraph data directly.";

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

export const MARKETING_STREAMS_PROMPT = STREAMS_EMPTY_PROMPT;

export const MARKETING_SUBGRAPHS_PROMPT = SUBGRAPHS_EMPTY_PROMPT;

export const MARKETING_WORKFLOWS_PROMPT = WORKFLOWS_EMPTY_PROMPT;
