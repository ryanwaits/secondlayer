/**
 * Agent prompts used across platform + marketing touchpoints.
 */

export type AgentPromptTag =
	| "subgraphs"
	| "subscriptions"
	| "mcp"
	| "sdk"
	| "cli"
	| "recovery";

export type AgentPromptSurface =
	| "marketing"
	| "platform-empty-state"
	| "platform-detail"
	| "dashboard";

export interface AgentPromptContext {
	subgraphName?: string;
	tables?: string[];
	subscriptionId?: string;
	subscriptionName?: string;
}

export interface AgentPromptDefinition {
	id: AgentPromptId;
	title: string;
	audience: string;
	surface: AgentPromptSurface;
	description: string;
	tags: AgentPromptTag[];
	build: (context?: AgentPromptContext) => string;
}

export type AgentPromptId =
	| "subgraph-create"
	| "subgraph-alex-swaps"
	| "subscription-create"
	| "subscription-diagnose"
	| "subscription-test"
	| "cli-operate"
	| "mcp-install"
	| "sdk-wire";

const SUBGRAPHS_INTRO =
	"Subgraphs are declarative SQL tables that auto-index Stacks blockchain activity into queryable Postgres tables. Define named sources, a typed schema, and handlers in TypeScript, then deploy and query.";

const SUBSCRIPTIONS_INTRO =
	"Subscriptions deliver inserted subgraph table rows to HTTPS receivers with signed payloads, retries, replay, delivery logs, and a dead-letter queue.";

export const AGENT_SETUP = `Ensure setup once, skipping any step already done:
- Skill: \`bunx skills add ryanwaits/secondlayer --skill secondlayer -y\`
- CLI: \`bun add -g @secondlayer/cli\`
- Auth: \`sl login\` then \`sl whoami\``;

function withSetup(body: string): string {
	return `${AGENT_SETUP}

${body}`.trim();
}

function formatTables(tables?: string[]): string {
	if (!tables?.length) return "No table list is available yet.";
	return `Known tables: ${tables.map((t) => `\`${t}\``).join(", ")}.`;
}

function subscriptionRef(context?: AgentPromptContext): string {
	if (context?.subscriptionName && context.subscriptionId) {
		return `"${context.subscriptionName}" (${context.subscriptionId})`;
	}
	if (context?.subscriptionName) return `"${context.subscriptionName}"`;
	if (context?.subscriptionId) return context.subscriptionId;
	return "the target subscription";
}

export const AGENT_PROMPTS: AgentPromptDefinition[] = [
	{
		id: "subgraph-create",
		title: "Create a subgraph from a contract",
		audience: "Developers indexing a Stacks contract",
		surface: "marketing",
		description:
			"Scaffold, refine, deploy, query, and offer a webhook subscription.",
		tags: ["subgraphs", "subscriptions"],
		build: () =>
			withSetup(`${SUBGRAPHS_INTRO}

/secondlayer Help me create a subgraph from a Stacks contract. Ask me for the contract id and the events or function calls I care about. Scaffold with \`sl subgraphs scaffold\`, explain the generated named sources and tables, let me review or customize the handlers, deploy with \`sl subgraphs deploy\`, query recent rows, then ask whether I want a subscription webhook.`),
	},
	{
		id: "subgraph-alex-swaps",
		title: "Index ALEX swaps",
		audience: "Developers starting from a concrete DeFi example",
		surface: "dashboard",
		description:
			"Scaffold a swap subgraph, deploy it, query rows, then offer a webhook.",
		tags: ["subgraphs", "subscriptions"],
		build: () =>
			withSetup(`${SUBGRAPHS_INTRO}

/secondlayer Scaffold a subgraph that indexes swap events from \`SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01\`. Use named object sources and \`event.data\` fields, deploy it, query recent swaps, then offer to create a webhook subscription.`),
	},
	{
		id: "subscription-create",
		title: "Create a receiver + subscription",
		audience: "Developers wiring a subgraph table to a webhook",
		surface: "platform-empty-state",
		description:
			"Create a runtime receiver and subscription for a known subgraph table.",
		tags: ["subscriptions", "subgraphs"],
		build: (context) => {
			const subgraph = context?.subgraphName
				? `"${context.subgraphName}"`
				: "the subgraph I choose";
			return withSetup(`${SUBSCRIPTIONS_INTRO}

/secondlayer Create a subscription webhook for subgraph ${subgraph}. ${formatTables(context?.tables)}

Inspect the account state first. If the subgraph and table are already clear, ask me only for the receiver runtime (\`node\`, \`inngest\`, \`trigger\`, or \`cloudflare\`) and the HTTPS receiver URL. Then create the subscription, show the one-time signing secret, and generate a signed test fixture only after I provide that secret.`);
		},
	},
	{
		id: "subscription-diagnose",
		title: "Diagnose delivery failure",
		audience: "Developers recovering a failing webhook",
		surface: "platform-detail",
		description:
			"Inspect detail, deliveries, DLQ, linked subgraph health, and next steps.",
		tags: ["subscriptions", "recovery"],
		build: (context) =>
			withSetup(`${SUBSCRIPTIONS_INTRO}

/secondlayer Diagnose ${subscriptionRef(context)}. Inspect subscription detail, recent deliveries, dead-letter rows, and the linked subgraph state. Return the highest-priority findings first. If dead rows exist, propose inspecting them before requeueing selected rows. Do not replay a block range until I confirm exact from/to blocks.`),
	},
	{
		id: "subscription-test",
		title: "Generate signed test curl",
		audience: "Developers testing a webhook receiver",
		surface: "platform-detail",
		description:
			"Generate Standard Webhooks body, headers, and curl without posting.",
		tags: ["subscriptions", "recovery"],
		build: (context) =>
			withSetup(`${SUBSCRIPTIONS_INTRO}

/secondlayer Generate a signed Standard Webhooks test fixture for ${subscriptionRef(context)}. Use only the signing secret I provide in chat; never request or recover the stored platform secret. Produce the JSON body, headers, and curl. Do not POST it.`),
	},
	{
		id: "cli-operate",
		title: "Operate with the CLI",
		audience: "Developers who want terminal-first workflows",
		surface: "marketing",
		description:
			"Use `sl` to inspect projects, deploy subgraphs, and manage subscriptions.",
		tags: ["cli", "subgraphs", "subscriptions"],
		build: () =>
			withSetup(
				"/secondlayer Operate this project through the `sl` CLI. Inspect the current project, instance, subgraphs, and subscriptions with JSON output first. Then help me run the exact `sl` commands for the task, including human confirmation before delete, reindex, rotate-secret, replay, or requeue.",
			),
	},
	{
		id: "mcp-install",
		title: "Install MCP server",
		audience: "Developers connecting Secondlayer to an MCP agent",
		surface: "marketing",
		description:
			"Configure the MCP server and verify subgraph/subscription tools.",
		tags: ["mcp", "subgraphs", "subscriptions"],
		build: () =>
			withSetup(
				"/secondlayer Install the Secondlayer MCP server for my agent. Generate the `bunx @secondlayer/mcp` config using `SL_SERVICE_KEY`, then verify tool availability for subgraphs and subscriptions: list, get, query, deploy, create, update, pause, resume, rotate-secret, deliveries, dead, requeue, and replay.",
			),
	},
	{
		id: "sdk-wire",
		title: "Wire SDK into an app",
		audience: "App developers using typed queries and webhooks",
		surface: "marketing",
		description:
			"Use the TypeScript SDK for typed subgraph queries and subscriptions.",
		tags: ["sdk", "subgraphs", "subscriptions"],
		build: () =>
			withSetup(
				"/secondlayer Wire `@secondlayer/sdk` into my app. Show typed subgraph queries with `getSubgraph`, then wire subscription creation and lifecycle calls: create, list, pause, resume, rotateSecret, recentDeliveries, dead, requeueDead, replay, and delete. Use concrete names from my project when available.",
			),
	},
];

export const AGENT_PROMPT_REGISTRY = Object.fromEntries(
	AGENT_PROMPTS.map((prompt) => [prompt.id, prompt]),
) as Record<AgentPromptId, AgentPromptDefinition>;

export function getAgentPrompt(
	id: AgentPromptId,
	context?: AgentPromptContext,
): string {
	return AGENT_PROMPT_REGISTRY[id].build(context);
}

export function getAgentPromptDefinition(
	id: AgentPromptId,
): AgentPromptDefinition {
	return AGENT_PROMPT_REGISTRY[id];
}

// ── Backward-compatible prompt exports ───────────────────────────

export const SUBGRAPHS_EMPTY_PROMPT = getAgentPrompt("subgraph-create");
export const QUICK_SUBGRAPH_PROMPT = getAgentPrompt("subgraph-alex-swaps");
export const DROPDOWN_DEPLOY_SUBGRAPH = getAgentPrompt("subgraph-create");
export const DASHBOARD_SUBGRAPHS_PROMPT = getAgentPrompt("subgraph-create");
export const MARKETING_SUBGRAPHS_PROMPT = getAgentPrompt("subgraph-create");
export const MARKETING_SUBSCRIPTIONS_PROMPTS = [
	getAgentPromptDefinition("subscription-create"),
	getAgentPromptDefinition("subscription-diagnose"),
	getAgentPromptDefinition("subscription-test"),
];
