/**
 * Agent prompts used across platform + marketing touchpoints.
 *
 * Structure: product explainer -> idempotent setup -> /secondlayer skill invocation
 */

const SUBGRAPHS_INTRO =
	"Subgraphs are declarative SQL tables that auto-index blockchain activity into queryable Postgres tables. Define a schema, write event handlers in TypeScript, deploy, and query — like a materialized view over the chain.";

const SETUP = `Ensure setup (skip any step already done, use the project's package manager):
- Skill: \`bunx skills add ryanwaits/secondlayer --skill secondlayer -y\`
- CLI: \`@secondlayer/cli\` installed globally
- Auth: \`sl login\``;

// ── Platform empty states (collapsible code blocks) ──────────────

export const SUBGRAPHS_EMPTY_PROMPT = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Help me create a subgraph. Ask me:
1. What contract do I want to index?
2. Which events or function calls should I track?
3. What columns do I need in my tables?

Scaffold the subgraph, validate it, let me review it, deploy it, query recent rows, then ask whether to create a subscription webhook.`;

// ── Dashboard quick-action cards (short, single-task) ────────────

export const QUICK_SUBGRAPH_PROMPT = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Scaffold a subgraph that indexes swap events from the ALEX DEX contract SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01, deploy it, query recent swaps, then offer to create a webhook subscription.`;

// ── Action dropdown items (data states) ──────────────────────────

export const DROPDOWN_DEPLOY_SUBGRAPH = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Scaffold and deploy a new subgraph. Ask me what contract and events to index, query recent rows after deploy, then offer to create a subscription webhook.`;

// ── Dashboard get-started (agent tab) ────────────────────────────

export const DASHBOARD_SUBGRAPHS_PROMPT = `${SUBGRAPHS_INTRO}

${SETUP}

/secondlayer Help me create a subgraph. Ask me:
1. What contract do I want to index?
2. Which events or function calls should I track?
3. What columns do I need in my tables?

Scaffold the subgraph, validate it, let me review it, deploy it, query recent rows, then ask whether to create a subscription webhook.`;

// ── Marketing docs (below intro prose) ───────────────────────────

export const MARKETING_SUBGRAPHS_PROMPT = SUBGRAPHS_EMPTY_PROMPT;
