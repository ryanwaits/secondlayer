/**
 * Agent prompts used across platform + marketing touchpoints.
 */

export type AgentPromptTag =
	| "subgraphs"
	| "webhooks"
	| "mcp"
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
	webhookId?: string;
	webhookName?: string;
	/**
	 * Facts the console can already see about the webhook. Appended to
	 * diagnosis-shaped prompts so the agent starts from evidence rather than
	 * re-deriving it, and so the operator can read exactly what state is being
	 * handed over.
	 */
	observed?: ObservedWebhookState;
}

export interface ObservedWebhookState {
	status?: string;
	url?: string;
	format?: string;
	runtime?: string | null;
	/** ISO instant the state was read, so a stale paste is obvious. */
	capturedAt?: string;
	circuitOpenedAt?: string | null;
	circuitFailures?: number;
	lastError?: string | null;
	lastSuccessAt?: string | null;
	deliveriesTotal?: number;
	deliveriesFailed?: number;
	dominantStatusCode?: number | null;
	p50DurationMs?: number | null;
	timeoutMs?: number;
	deadCount?: number;
	deadOldestBlock?: number | null;
	sourceTable?: string;
	sourceBlocksBehind?: number | null;
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
	| "webhook-create"
	| "webhook-diagnose"
	| "webhook-test"
	| "cli-operate"
	| "mcp-install";

const SUBGRAPHS_INTRO =
	"Subgraphs are declarative SQL tables that auto-index Stacks blockchain activity into queryable Postgres tables. Define named sources, a typed schema, and handlers in TypeScript, then deploy and query.";

const WEBHOOKS_INTRO =
	"Webhooks deliver a signed POST to a URL you run whenever a subgraph row is written or a chain event you named happens.";

export const AGENT_SETUP = `Ensure setup once, skipping any step already done:
- Skill: \`bunx skills add ryanwaits/secondlayer --skill secondlayer -y\`
- CLI: \`bun add -g @secondlayer/cli\`
- Instance: \`secondlayer init\` writes \`INSTANCE_TOKEN\`. Loopback \`/v1\` reads need no key.
- Hosted/archive: export \`SECONDLAYER_API_KEY\` (\`sk-sl_*\`) or \`secondlayer login --credits\`, then \`secondlayer whoami\``;

function withSetup(body: string): string {
	return `${AGENT_SETUP}

${body}`.trim();
}

function formatTables(tables?: string[]): string {
	if (!tables?.length) return "No table list is available yet.";
	return `Known tables: ${tables.map((t) => `\`${t}\``).join(", ")}.`;
}

/**
 * Renders the observed state as a plain bullet list. Omits every field the
 * console couldn't read, so the agent is never handed a confident-looking
 * "unknown" it might reason from.
 */
function formatObserved(observed?: ObservedWebhookState): string {
	if (!observed) return "";
	const lines: string[] = [];

	if (observed.status) {
		const circuit = observed.circuitOpenedAt
			? `; circuit open since ${observed.circuitOpenedAt}${
					observed.circuitFailures
						? ` (${observed.circuitFailures} consecutive failures)`
						: ""
				}`
			: "";
		lines.push(`- status: ${observed.status}${circuit}`);
	}
	if (observed.url) {
		const shape = [observed.runtime, observed.format]
			.filter(Boolean)
			.join(", ");
		lines.push(`- receiver: ${observed.url}${shape ? ` (${shape})` : ""}`);
	}
	if (observed.sourceTable) {
		const lag =
			observed.sourceBlocksBehind == null
				? ""
				: observed.sourceBlocksBehind === 0
					? "; source at chain tip"
					: `; source ${observed.sourceBlocksBehind} blocks behind chain tip`;
		lines.push(`- source: ${observed.sourceTable}${lag}`);
	}
	if (observed.lastError) {
		lines.push(`- last error: ${observed.lastError}`);
	}
	if (observed.deliveriesTotal) {
		const code =
			observed.dominantStatusCode != null
				? `, mostly ${observed.dominantStatusCode}`
				: "";
		const timing =
			observed.p50DurationMs != null && observed.timeoutMs
				? `; p50 ${observed.p50DurationMs}ms against a ${observed.timeoutMs}ms timeout`
				: "";
		lines.push(
			`- last ${observed.deliveriesTotal} attempts: ${observed.deliveriesFailed ?? 0} failed${code}${timing}`,
		);
	}
	// `undefined` means the caller didn't supply it; `null` means it genuinely
	// never succeeded. Only the latter is worth telling the agent.
	if (observed.lastSuccessAt !== undefined) {
		lines.push(
			observed.lastSuccessAt
				? `- last success: ${observed.lastSuccessAt}`
				: "- last success: never",
		);
	}
	if (observed.deadCount) {
		const oldest =
			observed.deadOldestBlock != null
				? `, oldest at block ${observed.deadOldestBlock}`
				: "";
		lines.push(`- dead-letter rows: ${observed.deadCount}${oldest}`);
	}

	if (lines.length === 0) return "";
	const stamp = observed.capturedAt ? `, captured ${observed.capturedAt}` : "";
	return `

Observed state${stamp}:
${lines.join("\n")}`;
}

function webhookRef(context?: AgentPromptContext): string {
	if (context?.webhookName && context.webhookId) {
		return `"${context.webhookName}" (${context.webhookId})`;
	}
	if (context?.webhookName) return `"${context.webhookName}"`;
	if (context?.webhookId) return context.webhookId;
	return "the target webhook";
}

export const AGENT_PROMPTS: AgentPromptDefinition[] = [
	{
		id: "subgraph-create",
		title: "Create a subgraph from a contract",
		audience: "Developers indexing a Stacks contract",
		surface: "marketing",
		description:
			"Scaffold, refine, deploy, query, and offer a webhook webhook.",
		tags: ["subgraphs", "webhooks"],
		build: () =>
			withSetup(`${SUBGRAPHS_INTRO}

/secondlayer Help me create a subgraph from a Stacks contract. Ask me for the contract id and the events or function calls I care about. Scaffold with \`secondlayer subgraphs scaffold\` so the module package and dependencies are prepared, explain the generated named sources and tables, let me review or customize the handlers, deploy with \`secondlayer subgraphs deploy\`, query recent rows, then ask whether I want a webhook webhook.`),
	},
	{
		id: "subgraph-alex-swaps",
		title: "Index ALEX swaps",
		audience: "Developers starting from a concrete DeFi example",
		surface: "dashboard",
		description:
			"Scaffold a swap subgraph, deploy it, query rows, then offer a webhook.",
		tags: ["subgraphs", "webhooks"],
		build: () =>
			withSetup(`${SUBGRAPHS_INTRO}

/secondlayer Scaffold a subgraph that indexes swap events from \`SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01\`. Use named object sources and \`event.data\` fields, deploy it, query recent swaps, then offer to create a webhook webhook.`),
	},
	{
		id: "webhook-create",
		title: "Create a receiver + webhook",
		audience: "Developers wiring a subgraph table to a webhook",
		surface: "platform-empty-state",
		description:
			"Create a runtime receiver and webhook for a known subgraph table.",
		tags: ["webhooks", "subgraphs"],
		build: (context) => {
			const subgraph = context?.subgraphName
				? `"${context.subgraphName}"`
				: "the subgraph I choose";
			return withSetup(`${WEBHOOKS_INTRO}

/secondlayer Create a webhook webhook for subgraph ${subgraph}. ${formatTables(context?.tables)}

Inspect the account state first. If the subgraph and table are already clear, ask me only for the receiver runtime (\`node\`, \`inngest\`, \`trigger\`, or \`cloudflare\`) and the HTTPS receiver URL. Then create the webhook, show the one-time signing secret, and generate a signed test fixture only after I provide that secret.`);
		},
	},
	{
		id: "webhook-diagnose",
		title: "Diagnose delivery failure",
		audience: "Developers recovering a failing webhook",
		surface: "platform-detail",
		description:
			"Inspect detail, deliveries, DLQ, linked subgraph health, and next steps.",
		tags: ["webhooks", "recovery"],
		build: (context) =>
			withSetup(`${WEBHOOKS_INTRO}

/secondlayer Diagnose ${webhookRef(context)}. Inspect webhook detail, recent deliveries, dead-letter rows, and the linked subgraph state. Return the highest-priority findings first. If dead rows exist, propose inspecting them before requeueing selected rows. Do not replay a block range until I confirm exact from/to blocks.${formatObserved(context?.observed)}`),
	},
	{
		id: "webhook-test",
		title: "Generate signed test curl",
		audience: "Developers testing a webhook receiver",
		surface: "platform-detail",
		description:
			"Generate Standard Webhooks body, headers, and curl without posting.",
		tags: ["webhooks", "recovery"],
		build: (context) =>
			withSetup(`${WEBHOOKS_INTRO}

/secondlayer Generate a signed Standard Webhooks test fixture for ${webhookRef(context)}. Use only the signing secret I provide in chat; never request or recover the stored platform secret. Produce the JSON body, headers, and curl. Do not POST it.${formatObserved(
				context?.observed
					? {
							// The fixture only needs the receiver's shape — delivery
							// history would be noise, and pasting it into a prompt that
							// gets shared alongside a secret is worth avoiding.
							url: context.observed.url,
							format: context.observed.format,
							runtime: context.observed.runtime,
							sourceTable: context.observed.sourceTable,
						}
					: undefined,
			)}`),
	},
	{
		id: "cli-operate",
		title: "Operate with the CLI",
		audience: "Developers who want terminal-first workflows",
		surface: "marketing",
		description:
			"Use `secondlayer` to init a runtime, deploy subgraphs, and manage webhooks.",
		tags: ["cli", "subgraphs", "webhooks"],
		build: () =>
			withSetup(
				"/secondlayer Operate this project through the `secondlayer` CLI. For a local instance start with `secondlayer init`, `secondlayer bootstrap`, and `secondlayer observer`. After restore, `secondlayer verify all --against <manifest>` (or `raw` / `decode:<name>` / `subgraph:<name>`) compares local data to the signed archive — `--deep` for semantic digests. Inspect subgraphs and webhooks with JSON output first. Then help me run the exact `secondlayer` commands for the task, including human confirmation before delete, reindex, rotate-secret, replay, or requeue.",
			),
	},
	{
		id: "mcp-install",
		title: "Install MCP server",
		audience: "Developers connecting Secondlayer to an MCP agent",
		surface: "marketing",
		description: "Configure the MCP server and verify subgraph/webhook tools.",
		tags: ["mcp", "subgraphs", "webhooks"],
		build: () =>
			withSetup(
				"/secondlayer Install the Secondlayer MCP server for my agent. Generate the `bunx @secondlayer/mcp` config with `SECONDLAYER_API_URL` (or `SL_API_URL`) and `INSTANCE_TOKEN` for the instance. For hosted archive/credits tools also set `SECONDLAYER_API_KEY`. Then verify tool availability for subgraphs and webhooks: list, get, query, deploy, create, update, pause, resume, rotate-secret, deliveries, dead, requeue, and replay.",
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
