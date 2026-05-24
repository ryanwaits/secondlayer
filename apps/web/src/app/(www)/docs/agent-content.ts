import {
	AGENT_SETUP,
	type AgentPromptId,
	getAgentPrompt,
	getAgentPromptDefinition,
} from "@/lib/agent-prompts";

export interface DocsAgentCard {
	title: string;
	description: string;
	/** Full copy-paste prompt (AGENT_SETUP + page-specific body). */
	prompt: string;
}

/** Card backed by a shared agent-prompts.ts variant (also used in platform/marketing). */
function variant(id: AgentPromptId): DocsAgentCard {
	const def = getAgentPromptDefinition(id);
	return {
		title: def.title,
		description: def.description,
		prompt: getAgentPrompt(id),
	};
}

/** Bespoke docs prompt — page-specific body prefixed with the shared setup block. */
function card(title: string, description: string, body: string): DocsAgentCard {
	return { title, description, prompt: `${AGENT_SETUP}\n\n${body}` };
}

/** Per-page agent prompts, each tailored to that surface's purpose. */
export const DOCS_AGENT_CARDS: Record<string, DocsAgentCard[]> = {
	"/docs": [
		card(
			"Get oriented",
			"Pick the right surface for what you're building.",
			"/secondlayer I'm new to Secondlayer. Explain the surfaces — Datasets, Index, Subgraphs, Subscriptions, Streams — and recommend which one fits my use case. Ask what I'm building, then point me at the next step.",
		),
		card(
			"Pull data fast",
			"Query a Foundation Dataset for recent rows.",
			"/secondlayer Help me pull Stacks data quickly. Query a Foundation Dataset (sBTC, STX transfers, PoX-4, or BNS) for recent rows, show the response shape, and explain cursor pagination.",
		),
	],

	"/docs/quickstart": [
		variant("subgraph-create"),
		card(
			"Verify my setup",
			"Confirm CLI, skill, auth, and instance are ready.",
			"/secondlayer Verify my Secondlayer setup end to end: run `sl whoami` and `sl instance info`, confirm the skill and CLI are installed, and tell me exactly what's missing and how to fix it.",
		),
	],

	"/docs/authentication": [
		card(
			"Authenticate & make a key",
			"Log in, then create a key for writes.",
			"/secondlayer Help me authenticate. Run `sl login`, confirm with `sl whoami`, then create an API key for write operations and show me how to pass it as a bearer token. Reads are public; keys gate writes only.",
		),
		card(
			"Rotate a key",
			"Rotate and re-wire an API key safely.",
			"/secondlayer Rotate my Secondlayer API key with `sl auth keys rotate`, then help me update everywhere the old key was used.",
		),
	],

	"/docs/datasets": [
		card(
			"Query a dataset",
			"Cursor-paginate a Foundation Dataset.",
			"/secondlayer Help me query a Foundation Dataset (sBTC, STX transfers, PoX-4, BNS, or network health). Ask which one and what I'm after, build the cursor-paginated request against `/v1/datasets`, and explain the data/meta envelope.",
		),
		card(
			"Bulk export to parquet",
			"Download full history for analytics.",
			"/secondlayer Help me bulk-download a Foundation Dataset as parquet, then show me how to load it into DuckDB or pandas for analysis.",
		),
	],

	"/docs/index": [
		card(
			"Query decoded events",
			"Filter blocks, txs, events, and contract calls.",
			"/secondlayer Help me query the Index API for decoded Stacks chain data. Ask me for a contract, principal, event type, or block range, build the filtered cursor-paginated request against `/v1/index`, and explain the response envelope.",
		),
	],

	"/docs/subgraphs": [
		variant("subgraph-create"),
		variant("subgraph-alex-swaps"),
		variant("subscription-create"),
		variant("cli-operate"),
	],

	"/docs/subscriptions": [
		variant("subscription-create"),
		variant("subscription-diagnose"),
		variant("subscription-test"),
	],

	"/docs/streams": [
		card(
			"Tail the event firehose",
			"Cursor-paginate the raw event stream.",
			"/secondlayer Help me consume the Streams event firehose from `/v1/streams`. Ask which event types I care about, page forward with the cursor, handle idempotency, and show me the loop to stay live.",
		),
		card(
			"Replay missed events",
			"Resume exactly from a cursor after downtime.",
			"/secondlayer Help me replay Stacks events from Streams starting at a specific cursor or block so I don't miss anything after downtime, and confirm deliveries are idempotent.",
		),
	],

	"/docs/rest-api": [
		card(
			"Explore the REST API",
			"Envelope, cursor, and filter grammar.",
			"/secondlayer Walk me through the Secondlayer REST API: the data/meta envelope, `_limit`/`_order`/`_cursor` pagination, and the filter/sort grammar. Then build a sample request for a surface I name (datasets, index, streams, or a subgraph table).",
		),
		variant("sdk-wire"),
	],

	"/docs/sdk": [
		variant("sdk-wire"),
		card(
			"Verify webhooks",
			"Check signatures before trusting a payload.",
			"/secondlayer Help me verify Secondlayer webhook signatures in my receiver using `verifyWebhookSignature` from `@secondlayer/sdk` before I process the payload, and reject anything that doesn't validate.",
		),
		card(
			"Build a checkpointed consumer",
			"Poll + commit cursors for an indexer or ETL.",
			"/secondlayer Help me build a checkpointed Streams consumer with `@secondlayer/sdk`'s `consume`: write rows inside `onBatch`, return the committed cursor, and resume safely on restart.",
		),
	],

	"/docs/cli": [variant("cli-operate"), variant("mcp-install")],
};

const DEFAULT_CARDS: DocsAgentCard[] = DOCS_AGENT_CARDS["/docs"];

export function docsAgentCards(slug: string): DocsAgentCard[] {
	return DOCS_AGENT_CARDS[slug] ?? DEFAULT_CARDS;
}
