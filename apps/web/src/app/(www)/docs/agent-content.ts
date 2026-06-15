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

/** Per-page agent prompts, each tailored to that surface's purpose. Every docs
 *  page has its own bespoke set — nothing falls back to a generic card. */
export const DOCS_AGENT_CARDS: Record<string, DocsAgentCard[]> = {
	"/docs": [
		card(
			"Get oriented",
			"Pick the right surface for what you're building.",
			"/secondlayer I'm new to Secondlayer. Explain the surfaces — Index, Subgraphs, Subscriptions, Streams — and recommend which one fits my use case. Ask what I'm building, then point me at the next step.",
		),
		card(
			"Curl /v1 right now",
			"Hit decoded data keyless, before installing anything.",
			"/secondlayer Show me the fastest keyless win: curl `/v1/index/events?limit=5` with no key, explain the response envelope and the resume cursor, then tell me which surface — Index, Subgraphs, or Streams — fits what I'm building.",
		),
		variant("subgraph-create"),
	],

	"/docs/quickstart": [
		card(
			"Run the quickstart",
			"Drive the five-command path to a live table.",
			"/secondlayer Walk me through the quickstart end to end: `sl subgraphs create my-balances --template sip-010-balances`, then `sl subgraphs deploy subgraphs/my-balances.ts`, then curl `/v1/subgraphs/my-balances/balances` to confirm it's live and keyless.",
		),
		card(
			"Verify my setup",
			"Confirm CLI, auth, and plan before deploying.",
			"/secondlayer Verify my Secondlayer setup before I deploy: run `sl whoami` to confirm auth, `sl doctor` to check the CLI and environment, and `sl billing` to confirm a plan or trial covers deploys — then tell me exactly what's missing and how to fix it.",
		),
		variant("subgraph-create"),
	],

	"/docs/authentication": [
		card(
			"Log in, scope a key",
			"Authenticate, then pick the right key product.",
			"/secondlayer Authenticate with `sl login`, confirm with `sl whoami`, then explain key products — `account` (owner; mints keys, reads both surfaces) vs scoped `streams` / `index` — and create the right one for what I'm doing. Reads are public; keys gate writes and scope reads.",
		),
		card(
			"Mint a scoped CI key",
			"Self-provision a scoped key without the dashboard.",
			'/secondlayer Help me mint a scoped key for CI without the console: with my owner key, create one via `sl keys create --product streams` (or `POST /v1/api-keys` with `{ "product": "streams" }`), capture the plaintext key shown once, and set it as `SL_API_KEY`.',
		),
		card(
			"Rotate a key or secret",
			"Rotate an API key or webhook signing secret safely.",
			"/secondlayer Help me rotate a secret. For an API key, rotate it in the console (https://secondlayer.tools/platform/api-keys); for a webhook signing secret run `sl subscriptions rotate-secret`. Then re-wire everywhere the old value was used and confirm nothing still references it.",
		),
	],

	"/docs/index": [
		card(
			"Query decoded events",
			"Filter every event type + contract calls by contract, principal, or block.",
			"/secondlayer Help me query the Index API. Ask me for an event_type (ft_transfer, stx_transfer, print, …) or contract calls, plus any contract/principal/block-range filter, then build the cursor-paginated request against `/v1/index/events` or `/v1/index/contract-calls` and explain the response envelope.",
		),
		card(
			"Build a mirror index",
			"Codegen the schema, run a checkpointed consumer with reorg rewind.",
			"/secondlayer Help me build my own index on `/v1/index`: run `sl index codegen --target kysely` for the mirror schema, then wire `index.events.consume()` — write rows in `onBatch`, return the committed cursor, handle `onReorg` by deleting from the fork height, and set `fromHeight: 0` to backfill from genesis.",
		),
		card(
			"Inspect a print schema",
			"Learn a contract's real print payload shape before designing tables.",
			"/secondlayer Curl `/v1/index/contracts/<contract_id>/print-schema` and walk me through the per-topic fields — Clarity type, the `camel_name` on `event.data`, and which fields are always present vs optional — so I can design tables that won't silently null.",
		),
	],

	"/docs/subgraphs": [
		variant("subgraph-create"),
		variant("subgraph-alex-swaps"),
		card(
			"Deploy to your database",
			"BYO Postgres + a typed ORM schema.",
			'/secondlayer Help me deploy a subgraph to my own Postgres: `sl subgraphs deploy <file> --database-url "$DATABASE_URL"`, generate a typed schema with `sl subgraphs codegen --target prisma|drizzle|kysely`, treat the tables as read-only, and explain the 422 breaking-change refusal on incompatible redeploys.',
		),
		card(
			"Publish and watch",
			"Make it public, then watch the backfill drain.",
			"/secondlayer Publish my subgraph with `sl subgraphs publish <name>` (explain the public namespace and `409 PUBLIC_NAME_TAKEN`), then watch the genesis backfill with `sl subgraphs status <name>` while reads already serve on `/v1/subgraphs/<name>/<table>`.",
		),
	],

	"/docs/subscriptions": [
		variant("subscription-create"),
		card(
			"Subscribe to chain events",
			"Webhook on raw chain activity, no subgraph.",
			"/secondlayer Help me create a chain subscription (no subgraph) with the SDK: build a `triggers` array with `trigger.*` factories — e.g. `trigger.contractCall({ contractId, functionName })` and `trigger.ftTransfer({ assetIdentifier, minAmount })` — pass it to `sl.subscriptions.create`, and explain the `chain.{type}.apply` / `chain.reorg.rollback` delivery envelope. (Chain subs are SDK/REST/MCP, not the CLI's subgraph-only create.)",
		),
		variant("subscription-diagnose"),
		variant("subscription-test"),
	],

	"/docs/streams": [
		card(
			"Tail the firehose",
			"Cursor-paginate the raw event stream.",
			"/secondlayer Help me read the Streams firehose from `/v1/streams/events` with `Authorization: Bearer $SL_API_KEY`: filter by `types` / `contract_id` / `sender`, page forward with `next_cursor`, and loop to stay live (deliveries are idempotent).",
		),
		card(
			"Build an indexer from zero",
			"Checkpointed consumer with automatic reorg rewind.",
			"/secondlayer Help me build a Streams indexer with `streams.events.consume`: write rows in `onBatch` and return `next_cursor` as the checkpoint, roll back in `onReorg` from `reorg.fork_point_height` (inclusive). For cold history, backfill with `events.replay({ from: 'genesis' })`, then tail live at the seam.",
		),
		card(
			"Pull dumps for DuckDB",
			"Query verified parquet locally, no indexer.",
			"/secondlayer Help me pull Streams parquet dumps with `sl streams pull` (sha256-verified against the signed manifest) and query them locally in DuckDB with `read_parquet('./**/*.parquet')` — no indexer required.",
		),
	],

	"/docs/rest-api": [
		card(
			"Explore the REST API",
			"Envelope, cursor, and filter grammar.",
			"/secondlayer Walk me through the Secondlayer REST envelope: rows under a named key (events/calls/rows) plus a top-level `next_cursor`, `tip`, and `reorgs`. Cover per-surface pagination — subgraph tables use `_limit`/`_order` (bare `limit`/`order` → 400), Index uses `limit` + `cursor`/`from_height`. Then build a curl against a surface I name.",
		),
		card(
			"Run an aggregate",
			"Scalar aggregates over a filtered set.",
			"/secondlayer Build a request against `/v1/subgraphs/<name>/<table>/aggregate` with `_count`, `_sum`, `_min`, and `_countDistinct` on the columns I name, and explain the lossless-string result shape plus the `NON_NUMERIC_COLUMN` / `TOO_MANY_AGGREGATES` errors.",
		),
	],

	"/docs/sdk": [
		card(
			"Wire the SDK",
			"One client, typed reads across every surface.",
			"/secondlayer Help me wire `@secondlayer/sdk` into my app: create a `SecondLayer({ apiKey })` client, read public subgraph rows with `sl.subgraphs.rows(name, table, opts)` → `{ rows, next_cursor, tip }`, and get a typed table client via `sl.subgraphs.typed(def)`.",
		),
		card(
			"Verify webhooks",
			"Check signatures before trusting a payload.",
			"/secondlayer Help me verify Secondlayer webhook signatures in my receiver using `verifyWebhookSignature` from `@secondlayer/sdk` before I process the payload, and reject anything that doesn't validate.",
		),
		card(
			"Verify a tx proof",
			"Trustless transaction-inclusion verification.",
			"/secondlayer Help me verify a transaction is in a Stacks block without trusting Secondlayer: fetch `/v1/index/transactions/<tx_id>/proof`, run `verifyTransactionProof(proof)` from `@secondlayer/sdk` server-side, then re-check fully trustlessly with `fetchRewardSet({ nodeUrl, cycle })` from my own node.",
		),
		card(
			"Checkpointed consumer",
			"Poll + commit cursors for an indexer or ETL.",
			"/secondlayer Help me build a checkpointed Streams consumer with `@secondlayer/sdk`'s `consume`: write rows inside `onBatch`, return the committed cursor, and resume safely on restart.",
		),
	],

	"/docs/verification": [
		card(
			"Verify a tx proof",
			"Fetch and recompute a transaction-inclusion proof.",
			'/secondlayer Help me verify a Stacks transaction is in a block without trusting Secondlayer. Fetch `/v1/index/transactions/<tx_id>/proof`, run `verifyTransactionProof(proof)` from `@secondlayer/sdk` server-side, and explain whether I got `level: "anchored"` vs `"consensus"` and whether `ok` is true.',
		),
		card(
			"Go fully trustless",
			"Resolve the reward set from your own node.",
			'/secondlayer Make my proof verification fully trustless: after fetching the proof, call `fetchRewardSet({ nodeUrl, cycle })` against my own stacks-node, pass it into `verifyTransactionProof(proof, { rewardSet })`, and confirm `rewardSetSource` is `"provided"`.',
		),
		card(
			"Handle proof errors",
			"React to 404/503 proof responses.",
			"/secondlayer Help me handle the proof endpoint's error cases — `404 PROOF_UNAVAILABLE`, the fail-safe `503 PROOF_TX_SET_INCOMPLETE`, and the retryable `503 PROOF_NODE_UNAVAILABLE` — by writing a fetch wrapper that retries the node-unavailable case with backoff.",
		),
	],

	"/docs/contracts": [
		card(
			"Find contracts by trait",
			"List every SIP-010/009/013 conformer.",
			"/secondlayer Query `/v1/contracts?trait=sip-010&conformance=any`, explain declared vs inferred classification and the `declared_traits` / `inferred_standards` fields, and cursor-paginate with `next_cursor` until it's null.",
		),
		card(
			"Index a whole standard",
			"Trait-scoped subgraph source, no addresses.",
			'/secondlayer Help me write a subgraph source that points at a trait instead of a contract — e.g. `{ type: "ft_transfer", trait: "sip-010" }` — so it indexes every conforming contract, including ones deployed later, then deploy and query it.',
		),
		card(
			"Scaffold from a hit",
			"Go from a registry result to a subgraph.",
			"/secondlayer Pick a contract from `/v1/contracts` for the standard I name, then scaffold a subgraph from it with `sl subgraphs create <name> --from-contract <id>` and deploy.",
		),
	],

	"/docs/mcp": [
		variant("mcp-install"),
		card(
			"Read context first",
			"Orient via MCP resources before calling tools.",
			"/secondlayer Before calling any tool, read the `secondlayer://context` resource for my account, the chain tips, and what I can do — plus `secondlayer://filters` and `secondlayer://chain-triggers` — then tell me which tools are available given my auth.",
		),
		card(
			"Query decoded data",
			"Use the index_* read tools.",
			"/secondlayer Call `index_discover` to learn the event types and filters, then run `index_events` (or `index_ft_transfers` / `index_contract_calls`) for the contract or principal I name and cursor-paginate the result.",
		),
		card(
			"Deploy and subscribe",
			"Subgraph and webhook lifecycle as tools.",
			"/secondlayer Use `subgraphs_deploy` (run `dryRun` first to preview the DDL) for the contract I name, then `subscriptions_create` for a webhook on a table — and capture the one-time `signingSecret` it returns.",
		),
	],

	"/docs/x402": [
		card(
			"Pay per call",
			"Wrap fetch and pay a 402 with a wallet.",
			"/secondlayer Wire up x402 pay-per-call against `/v1/index/events`: wrap fetch with `withX402(fetch, { account })` from `@secondlayer/sdk` so a `402 Payment Required` triggers a sponsored, zero-gas transfer and an auto-retry, then read the receipt with `readX402Receipt(res)`.",
		),
		card(
			"Check the rail",
			"Inspect live x402 state and quotes.",
			"/secondlayer Check whether the x402 rail is live: hit `GET /.well-known/x402` for `enabled`, explain my free path (1,000 keyless `/v1/index` reads per IP per day; Streams pays from the first call), and decode a `402` quote's `accepts[]` — `asset`, `amount`, `payTo`, `extra.nonce`.",
		),
		card(
			"Sponsored deploy",
			"Deploy a wallet-owned subgraph via x402.",
			"/secondlayer Help me deploy a subgraph I own by wallet using x402 — a paid `POST /v1/subgraphs` with no account or key. Explain how the sponsored transfer settles and whether a Streams session voucher or a prepaid tab fits a steady poller better.",
		),
	],

	"/docs/changelog": [
		card(
			"What changed since",
			"Catch up from your last integrated version.",
			"/secondlayer Read the Secondlayer changelog at https://secondlayer.tools/docs/changelog and tell me what shipped since the version I'm on — ask my `@secondlayer/sdk` or `cli` version, or the date I last integrated. Group by surface (Index, Subgraphs, Subscriptions, Streams) and flag anything affecting my current code.",
		),
		card(
			"Adopt a new feature",
			"Migrate onto a recent capability.",
			"/secondlayer From the latest Secondlayer changelog, help me adopt one new capability — e.g. Index `consume()` consumers, chain subscriptions via `triggers[]`, subgraph `/aggregate`, or Streams `events.replay({ from: 'genesis' })`. Ask which I want, then wire it in with the exact SDK/CLI calls.",
		),
	],

	"/docs/cli": [
		variant("cli-operate"),
		card(
			"Orient with sl context",
			"A headless snapshot before you act.",
			"/secondlayer Run `sl context` and summarize my account, the live Streams and Index tips, my subgraphs and subscriptions, and any in-flight reindex ops — then recommend the next `sl` command for what I'm doing.",
		),
		card(
			"Scaffold from a contract",
			"Typed print payloads, no login required.",
			"/secondlayer Run `sl subgraphs create <name> --from-contract <contract-id>` to infer typed print payloads from indexed history, walk me through the generated `print_event` sources and wide table, then `sl subgraphs deploy` and query recent rows.",
		),
	],

	"/docs/self-host": [
		card(
			"Bring up the stack",
			"Run app services with Docker Compose.",
			"/secondlayer Help me self-host Secondlayer: clone the repo, `cd docker/oss`, `cp .env.example .env` (set `POSTGRES_PASSWORD`), then `docker compose up -d postgres migrate api indexer subgraph-processor` and verify `curl http://localhost:3800/health`. Show me how to point an existing stacks-node at the indexer on `:3700` via `events_observer`.",
		),
		card(
			"Run published images",
			"Pull ghcr images and pin a safe tag.",
			"/secondlayer Help me run Secondlayer from the published `ghcr.io/ryanwaits/secondlayer-*` images instead of building from source — pin a tag cut after the OSS read-parity fix (older tags return `402 UPGRADE_REQUIRED` on reads), and swap the compose `build:` blocks for `image:`.",
		),
		card(
			"Sync from genesis",
			"Backfill, then deploy against your instance.",
			"/secondlayer Walk me through a genesis sync: start with `TIP_FOLLOWER_ENABLED=false`, track progress via `curl http://localhost:3700/health | jq .block_height` against the chain tip, re-enable the tip follower, then deploy a subgraph against my local instance with `SL_API_URL=http://localhost:3800` and `sl subgraphs deploy`.",
		),
	],
};

/** Last-resort default for an unknown slug — every real docs page has its own
 *  set above, so this should never render in practice. */
const DEFAULT_CARDS: DocsAgentCard[] = DOCS_AGENT_CARDS["/docs"];

export function docsAgentCards(slug: string): DocsAgentCard[] {
	return DOCS_AGENT_CARDS[slug] ?? DEFAULT_CARDS;
}
