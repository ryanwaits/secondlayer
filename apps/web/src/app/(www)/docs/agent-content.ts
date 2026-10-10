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
			"Sweep it into my database",
			"Stand up a checkpointed consumer end to end.",
			"/secondlayer Help me build my own index on Secondlayer: run `secondlayer codegen index --target kysely` for the mirror schema, write a `consume()` loop that commits rows and the checkpoint in one transaction, handle `onReorg` by deleting from `fork_point_height` up, then point me at a deploy target.",
		),
		card(
			"Run the quickstart",
			"Drive the golden path to a live table.",
			"/secondlayer Walk me through the quickstart end to end: install the CLI, export `SECONDLAYER_API_URL=https://api.secondlayer.tools` and `SECONDLAYER_API_KEY` (`sk-sl_*`, from /account/keys), `secondlayer subgraphs create my-balances --from-contract <my contract id>`, `secondlayer subgraphs deploy subgraphs/my-balances.ts` (set a `startBlock`), then curl `$SECONDLAYER_API_URL/v1/subgraphs/my-balances/balances` with `Authorization: Bearer $SECONDLAYER_API_KEY` to confirm it's live. If I'd rather run my own box, point me at /docs/self-host.",
		),
		card(
			"Verify my setup",
			"Confirm the instance is healthy before deploying.",
			"/secondlayer Verify my Secondlayer setup before I deploy: run `secondlayer status` to confirm the instance is up and ingesting, and `secondlayer verify all` to check my data against the signed archive — then tell me exactly what's wrong and how to fix it.",
		),
		variant("subgraph-create"),
	],

	"/docs/authentication": [
		card(
			"Wire my account key",
			"Send the hosted key from the SDK, CLI, MCP and curl.",
			"/secondlayer Help me wire my account key: export `SECONDLAYER_API_URL=https://api.secondlayer.tools` and `SECONDLAYER_API_KEY` (`sk-sl_*`, from /account/keys), confirm a read with `Authorization: Bearer $SECONDLAYER_API_KEY`, and set the same two variables in CI. The SDK, MCP and CLI pick the key from the host. Never put it in `INSTANCE_TOKEN`.",
		),
		card(
			"Cap my spend",
			"Spend cap and balance alerts before the first bill.",
			"/secondlayer Help me avoid surprise bills: explain the 1M free rows a month, then set a monthly spend cap and both balance alerts at /account/credits. Tell me what `402 spend_cap_reached` and `402 insufficient_credits` mean and how to clear each.",
		),
		card(
			"Rotate a webhook secret",
			"Rotate a webhook signing secret safely.",
			"/secondlayer Help me rotate a webhook signing secret: run `secondlayer webhooks rotate-secret`, update the receiver that calls `verifyWebhookSignature`, then confirm nothing still references the old value.",
		),
	],

	"/docs/index": [
		card(
			"Query decoded events",
			"Filter every event type + contract calls by contract, principal, or block.",
			"/secondlayer Help me query the Index API. Ask me for an event_type (ft_transfer, stx_transfer, print, …) or contract calls, plus any contract/principal/block-range filter, then build the cursor-paginated request against `/v1/index/events` or `/v1/index/contract-calls` at `$SECONDLAYER_API_URL` with `Authorization: Bearer $SECONDLAYER_API_KEY` and explain the response envelope.",
		),
		card(
			"Build a mirror index",
			"Codegen the schema, run a checkpointed consumer with reorg rewind.",
			"/secondlayer Help me build my own index on `/v1/index`: run `secondlayer codegen index --target kysely` for the mirror schema, then wire `index.events.consume()` — write rows in `onBatch`, return the committed cursor, handle `onReorg` by deleting from the fork height, and set `fromHeight: 0` to backfill from genesis.",
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
			"Typed ORM schema",
			"Codegen a Prisma/Drizzle/Kysely schema for a subgraph on your own box.",
			"/secondlayer Help me generate a typed ORM schema for my subgraph with `secondlayer codegen subgraph --target prisma|drizzle|kysely`, wire it into my app, and treat the tables as read-only. This needs direct Postgres access, so it is self-host only; hosted subgraphs are read over REST.",
		),
		card(
			"Watch the backfill",
			"Deploy, then watch the backfill drain.",
			"/secondlayer Watch the genesis backfill with `secondlayer subgraphs status <name>` while reads already serve on `/v1/subgraphs/<name>/<table>`, and explain what the operation progress and ETA mean.",
		),
	],

	"/docs/subgraphs/hosted": [
		card(
			"Deploy a hosted subgraph",
			"Deploy to the hosted API with an account key.",
			"/secondlayer Help me deploy a subgraph to the hosted API: set `SECONDLAYER_API_URL` and `SECONDLAYER_API_KEY` (`sk-sl_*` from /account/keys, see /docs#get-started), set a `startBlock` so the reindex is bounded (event and transaction rows bill), run `secondlayer subgraphs deploy`, then read `/v1/subgraphs/<name>/<table>` with the key as a bearer token. Check my sources are hostable (event filters, `contract_call`, `contract_deploy`) or tell me which one gets `SOURCE_NOT_HOSTABLE`.",
		),
		card(
			"Fix a failing hosted subgraph",
			"Diagnose an `error` status after restarts.",
			"/secondlayer My hosted subgraph is marked `error`. Run `secondlayer subgraphs status <name>`, explain that a processor that stalls or runs out of its 512 MB is restarted and marked `error` after 3 deaths at the same height, find the handler at that block, fix it, and redeploy.",
		),
	],

	"/docs/webhooks": [
		variant("webhook-create"),
		card(
			"Webhook on chain events",
			"Webhook on raw chain activity, no subgraph.",
			"/secondlayer Help me create a chain webhook (no subgraph) with the SDK: build a `triggers` array with `trigger.*` factories — e.g. `trigger.contractCall({ contractId, functionName })` and `trigger.ftTransfer({ assetIdentifier, minAmount })` — pass it to `sl.webhooks.create`, and explain the `chain.{type}.apply` / `chain.reorg.rollback` delivery envelope. (Chain subs are SDK/REST/MCP, not the CLI's subgraph-only create.)",
		),
		variant("webhook-diagnose"),
		variant("webhook-test"),
	],

	"/docs/streams": [
		card(
			"Tail the firehose",
			"Cursor-paginate the raw event stream.",
			"/secondlayer Help me read the Streams firehose from `$SECONDLAYER_API_URL/v1/streams/events` (send `Authorization: Bearer $SECONDLAYER_API_KEY`): filter by `types` / `contract_id` / `sender`, page forward with `next_cursor`, and loop to stay live (deliveries are idempotent).",
		),
		card(
			"Build an indexer from zero",
			"Checkpointed consumer with automatic reorg rewind.",
			"/secondlayer Help me build a Streams indexer with `streams.events.consume`: write rows in `onBatch` and return `next_cursor` as the checkpoint, roll back in `onReorg` from `reorg.fork_point_height` (inclusive). For cold history, backfill with `events.replay({ from: 'genesis' })`, then tail live at the seam.",
		),
		card(
			"Pull dumps for DuckDB",
			"Query verified dumps locally, no indexer.",
			"/secondlayer Help me pull Streams bulk dumps with `secondlayer streams dumps` (sha256-verified against the signed manifest) and query them locally in DuckDB with `read_parquet('./**/*.parquet')` — no indexer required.",
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
			"/secondlayer Help me wire `@secondlayer/sdk` into my app: create a `new SecondLayer()` client (it reads `SECONDLAYER_API_URL`), read subgraph rows with `sl.subgraphs.rows(name, table, opts)` → `{ rows, next_cursor, tip }`, and get a typed table client via `sl.subgraphs.typed(def)`. The key follows the host: `SECONDLAYER_API_KEY` on the hosted API, `INSTANCE_TOKEN` on my own box; `accountKey` is only for archive operations.",
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

	"/docs/pox5-events": [
		card(
			"Read bond prints",
			"Index feed filtered by register-for-bond.",
			"/secondlayer Show me how to read PoX-5 protocol-bond registrations from Index: GET /v1/index/pox5/events?topic=register-for-bond, and a chain webhook trigger print_event on SP000000000000000000002Q6VF78.pox-5 with that topic. Point at /docs/pox5-events and /docs/webhooks.",
		),
		card(
			"Webhook on bond registrations",
			"Chain webhook for register-for-bond prints.",
			"/secondlayer Create a PoX-5 bond-registration webhook with `secondlayer webhooks create`: trigger print_event on SP000000000000000000002Q6VF78.pox-5 topic register-for-bond. Point at /docs/pox5-events and /docs/webhooks.",
		),
	],

	"/docs/archive": [
		card(
			"Check local data against the archive",
			"Run secondlayer verify on raw, a decoder, or a subgraph.",
			"/secondlayer Help me verify my local Secondlayer database against a signed archive: `secondlayer verify raw --against <latest.json>` for blocks/transactions/events, `secondlayer verify decode:ft_transfer --against <latest.json> --deep` for one decoder, or `secondlayer verify all`. Explain exit `0`/`1`/`2` and what `--quick`, `--deep`, and `--anchor` do.",
		),
		card(
			"Repair what diverged",
			"Plan first, then apply signed archive rows.",
			"/secondlayer My `secondlayer verify` exited 1. Show me `secondlayer repair --against <archive>` (dry-run) then `--apply`. Name exact heights, refuse unsigned objects, and do not delete local heights the archive does not have.",
		),
		card(
			"Bootstrap a fresh instance",
			"Restore history instead of syncing from genesis.",
			"/secondlayer Stand up an empty instance from the archive: `secondlayer bootstrap --against <manifest>`. Explain the two timings, that a non-empty database is refused (`secondlayer repair` instead), and `--to-block` / `-y`.",
		),
	],

	"/docs/verification": [
		card(
			"Verify a block",
			"Prove one block from the checkpoint, link by link.",
			"/secondlayer Run `secondlayer verify block <height>` against my instance and explain each link it prints (bitcoin, burn, cycle, signatures, txs, state root, diff), what the exit code (`0`, `1`, `2`) means, and what is still trusted: only the checkpoint.",
		),
		card(
			"Verify in code",
			"Use @secondlayer/verify from a script.",
			"/secondlayer Add `@secondlayer/verify` to my project and call `verifyBlock(height, { source })` with a `SecondlayerProofSource`, then switch to a `BlockVerifier` with `NodeRpcProofSource` spread over it so blocks and MARF proofs come from my own node. Throw `result.failures[0].message` when `ok` is false.",
		),
		card(
			"Prove a transaction",
			"Fetch a proof and go fully trustless.",
			'/secondlayer Fetch `/v1/index/transactions/<tx_id>/proof`, run `verifyTransactionProof(proof)` from `@secondlayer/sdk` server-side, then call `fetchRewardSet({ nodeUrl, cycle })` against my own stacks-node and pass it as `{ rewardSet }` until `rewardSetSource` is `"provided"`. Handle `404 PROOF_UNAVAILABLE` and retry `503 PROOF_NODE_UNAVAILABLE`.',
		),
	],

	"/docs/sbtc-settlement": [
		card(
			"Check a peg-out's settlement",
			"See if a withdrawal's BTC sweep actually landed.",
			"/secondlayer Help me read BTC L1 settlement for an sBTC peg-out: GET `/v1/index/sbtc/withdrawals/:request_id`, then explain the `settlement` object — `sweep_txid`, `btc_confirmations`, `settlement_confirmed`, `btc_block_height`, `confirmed_at` — and what a `null` field means (the committed sweep hasn't been observed on Bitcoin yet, not a denial). Note deposits need no such check — `completed-deposit` only fires after the signers see BTC confirmations.",
		),
		card(
			"List confirmed peg-outs",
			"Filter withdrawals by Bitcoin settlement state.",
			"/secondlayer Show me how to filter peg-outs by settlement: curl `/v1/index/sbtc/withdrawals?settlement_confirmed=true` for sweeps confirmed on Bitcoin and `?settlement_confirmed=false` for the pending set (accepted-but-not-confirmed, or no sweep yet). Explain the per-row `settlement_confirmed` flag and cursor-paginate with `next_cursor`.",
		),
		card(
			"Get notified when a sweep confirms",
			"Webhook the moment a peg-out settles on Bitcoin.",
			"/secondlayer Help me set up sBTC settlement webhooks: `client.webhooks.create({ url, triggers: [trigger.sbtcWithdrawalSweptConfirmed()] })`. Explain that it fires once per sweep when `btc_confirmations` crosses the threshold (default 6), is forward-only (only settlements confirmed after I create it), and never double-fires on a reorg→un-confirm→re-confirm. Show the `chain.sbtc_withdrawal_swept_confirmed.apply` envelope shape and how to verify the signature.",
		),
	],

	"/docs/runes": [
		card(
			"Read the rune catalog and one entry",
			"List, search, and fetch a single rune by id or name.",
			'/secondlayer Help me read Bitcoin Runes from Index: `sl.index.runes.list({ search: "dog", sort: "mints" })` for the catalog, and `sl.index.runes.get("840000:3")` for one entry (accepts an id or a name, spacers/case ignored). Explain the computed `supply` field and that `get` resolves to `null` on 404. Point at /docs/runes.',
		),
		card(
			"Walk rune activity for an address",
			"Page or stream etch/mint/transfer/burn events.",
			"/secondlayer Help me read Runes activity from Index: `sl.index.runes.activity.list({ address, fromHeight })` for a page, or `for await (const e of sl.index.runes.activity.walk({ address }))` to sweep it. Explain the cursor shape, the `kind` filter (rune_etch/rune_mint/rune_transfer/rune_burn), and that reorgs on this feed are block-level (no event_index component). Point at /docs/runes.",
		),
		card(
			"Webhook on rune transfers",
			"Fire on rune activity instead of polling.",
			'/secondlayer Create a Runes transfer webhook with `client.webhooks.create({ url, triggers: [trigger.runeTransfer({ rune: "840000:3", minAmount: "1000000" })] })`. Explain the other three triggers (runeEtch, runeMint, runeBurn), that a rune name is resolved to its id at create time, and that a name is rejected with a hint to use the id when the instance has no Runes data configured. Point at /docs/runes and /docs/webhooks.',
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
			"/secondlayer Pick a contract from `/v1/contracts` for the standard I name, then scaffold a subgraph from it with `secondlayer subgraphs create <name> --from-contract <id>` and deploy.",
		),
	],

	"/docs/mcp": [
		variant("mcp-install"),
		card(
			"Read context first",
			"Orient via MCP resources before calling tools.",
			"/secondlayer Before calling any tool, read the `secondlayer://context` resource for the instance state, the chain tips, and what I can do — plus `secondlayer://filters` and `secondlayer://chain-triggers` — then tell me which tools are available.",
		),
		card(
			"Query decoded data",
			"Use the index_* read tools.",
			"/secondlayer Call `index_discover` to learn the event types and filters, then run `index_events` (or `index_ft_transfers` / `index_contract_calls`) for the contract or principal I name and cursor-paginate the result.",
		),
		card(
			"Deploy and subscribe",
			"Subgraph and webhook lifecycle as tools.",
			"/secondlayer Use `subgraphs_deploy` (run `dryRun` first to preview the DDL) for the contract I name, then `webhooks_create` for a webhook on a table — and capture the one-time `signingSecret` it returns.",
		),
	],

	"/docs/changelog": [
		card(
			"What changed since",
			"Catch up from your last integrated version.",
			"/secondlayer Read the Secondlayer changelog at https://secondlayer.tools/docs/changelog and tell me what shipped since the version I'm on — ask my `@secondlayer/sdk` or `cli` version, or the date I last integrated. Group by surface (Index, Subgraphs, Webhooks, Streams) and flag anything affecting my current code.",
		),
		card(
			"Adopt a new feature",
			"Migrate onto a recent capability.",
			"/secondlayer From the latest Secondlayer changelog, help me adopt one new capability — e.g. Index `consume()` consumers, chain webhooks via `triggers[]`, subgraph `/aggregate`, or Streams `events.replay({ from: 'genesis' })`. Ask which I want, then wire it in with the exact SDK/CLI calls.",
		),
	],

	"/docs/cli": [
		card(
			"Stand up a local runtime",
			"Guided setup, or init, bootstrap, print the observer stanza.",
			"/secondlayer Help me run Secondlayer on my own box (or skip it: with `SECONDLAYER_API_URL` and `SECONDLAYER_API_KEY` set to the hosted values, `secondlayer subgraphs` / `webhooks` run hosted): `secondlayer setup` walks through network/node-mode, writes secrets + docker-compose + .env, brings the stack up, restores verified history, and verifies it — or step by step, `secondlayer init --network mainnet` writes `.env.local`, `secondlayer bootstrap --against <manifest>` restores verified history into an empty database, and `secondlayer observer --mode indexer` prints the `[[events_observer]]` stanza, then `secondlayer verify all --against <manifest>` checks the restore. Explain flags, exit codes, and when to use `--mode signer-shared`.",
		),
		variant("cli-operate"),
		card(
			"Scaffold from a contract",
			"Typed print payloads from indexed history.",
			"/secondlayer Run `secondlayer subgraphs create <name> --from-contract <contract-id>` to infer typed print payloads from indexed history, walk me through the generated `print_event` sources and wide table, then `secondlayer subgraphs deploy` and query recent rows.",
		),
	],

	"/docs/sdk-reference": [
		card(
			"Find the right export",
			"Locate the call for what I'm trying to do.",
			"/secondlayer I know what I want to do but not what it's called in `@secondlayer/sdk`. Ask what I'm building, then name the exact export, show its signature, and give me a working snippet against a real contract.",
		),
		card(
			"Check what changed",
			"Diff the surface against the version I'm on.",
			"/secondlayer I'm pinned to an older `@secondlayer/sdk`. Compare my version against the current surface, list exports that were added or deprecated, and tell me what I'd have to touch to upgrade.",
		),
	],

	"/docs/api-reference": [
		card(
			"Find the right endpoint",
			"Map what I need to a route and its fields.",
			"/secondlayer Read https://secondlayer.tools/docs/api-reference.md (every endpoint and object, generated from the OpenAPI spec). Tell me which endpoint serves what I'm after, which filters narrow it, which object fields I'll read, and link the exact section as https://secondlayer.tools/docs/api-reference#<anchor>.",
		),
		card(
			"Call one endpoint",
			"Build a real request from its own page.",
			"/secondlayer Fetch the endpoint's markdown at https://secondlayer.tools/docs/api-reference/<anchor>.md, where <anchor> is its operationId in kebab case (e.g. list-pox5-events). Build the request for my base URL (hosted needs `SECONDLAYER_API_KEY`; a loopback instance needs no key), then page it by passing `next_cursor` back as `cursor` and undo rows named in `reorgs[]`.",
		),
		card(
			"Generate a client from the spec",
			"Typed calls in my language, from the live spec.",
			"/secondlayer Pull the OpenAPI description from `GET $SECONDLAYER_API_URL/v1/openapi.json` and generate a typed client in my language. Keep the operationIds as method names, since they are stable, and wire auth as the spec's optional bearer.",
		),
		card(
			"Use the SDK instead",
			"Swap hand-rolled HTTP for the typed client.",
			"/secondlayer I've been calling `/v1` by hand with my own paging loop. Show me the `@secondlayer/sdk` equivalent: `walk()` for cursor following, `consume()` for a checkpointed sweep, and what my code stops having to handle.",
		),
	],

	"/docs/deploy": [
		card(
			"Pick a target",
			"Match my stack to a deploy recipe.",
			"/secondlayer I have a `consume()` loop and need somewhere to run it. Ask what I already use for hosting and Postgres, then point me at the matching guide — Railway, Render, Fly, Vercel cron, or Docker — and list what I have to add: a Dockerfile, a `/health` route, and a SIGTERM handler.",
		),
		card(
			"Make my loop deploy-safe",
			"Audit idempotency, health, and shutdown.",
			"/secondlayer Review my indexer for production: are writes idempotent (conflict rule on every insert), do rows and the checkpoint commit in one transaction, does something answer on `PORT`, and is an `AbortSignal` wired to `SIGTERM` so the in-flight batch commits before exit? Show me the diffs.",
		),
		card(
			"Containerize it",
			"Write a Dockerfile that shuts down cleanly.",
			"/secondlayer Write a Dockerfile for my Secondlayer consumer: install deps from the lockfile, bind the health server to `PORT`, and use exec-form `CMD` so the process receives `SIGTERM` as PID 1 instead of a shell swallowing it.",
		),
	],

	"/docs/self-host": [
		card(
			"Bring up the stack",
			"Run app services with Docker Compose.",
			'/secondlayer Help me self-host Secondlayer: `bun add -g @secondlayer/cli`, then `secondlayer setup` — it writes secrets, docker-compose.yml, and .env into a target directory (no manual copy-paste), brings up postgres + the secondlayer container, and verifies `curl http://127.0.0.1:3800/health` for me. For an external node, it prints the observer stanza to paste into `Config.toml` (`endpoint = "secondlayer:3700"`); for a bundled node (`--node-mode stacks|full`) that step doesn\'t apply.',
		),
		card(
			"Point the examples at my box",
			"Set the URL and the instance token for reads and writes.",
			"/secondlayer Help me use the docs examples against my own box: `export SECONDLAYER_API_URL=http://127.0.0.1:3800`, reads on loopback need no key, writes and any read past loopback send `Authorization: Bearer $INSTANCE_TOKEN` (the CLI and SDK send it for me). Leave `SECONDLAYER_API_KEY` alone, it is the hosted account key that archive credits read. Then deploy a subgraph against my instance and read it back with curl.",
		),
		card(
			"Run published images",
			"Pull ghcr images and pin a release tag.",
			"/secondlayer Help me run Secondlayer from the published `ghcr.io/ryanwaits/secondlayer-*` images instead of building from source: pin a release tag, and swap the compose `build:` blocks for `image:`.",
		),
		card(
			"Sync from genesis",
			"Backfill, then deploy against your instance.",
			"/secondlayer Walk me through a genesis sync with a Stacks node that is itself syncing from genesis (an already-synced node only sends new blocks): start with `TIP_FOLLOWER_ENABLED=false`, track progress via `curl http://localhost:3700/health | jq .block_height` against the chain tip, re-enable the tip follower, `secondlayer verify all --against <manifest>`, then deploy a subgraph against my local instance with `SECONDLAYER_API_URL=http://127.0.0.1:3800` and `secondlayer subgraphs deploy`.",
		),
		card(
			"Upgrade X to Y",
			"Name the running image, pick a later tag, keep the keys.",
			"/secondlayer Help me upgrade my self-hosted Secondlayer instance from X to Y. First identify X: `curl -s $SECONDLAYER_API_URL/health`, `docker compose images`, `secondlayer --version`. Ask me for Y (a `v*` tag from GitHub releases, or a git commit if I build from source). Read changelog entries dated after X at https://www.secondlayer.tools/docs/changelog. Keep `postgres_data`, `subgraphs_data` and `.env` (`SECONDLAYER_SECRETS_KEY`, `INSTANCE_TOKEN`, the signing keys); a new secrets key makes existing `whsec_` secrets unreadable. Never `docker compose down -v`, never `secondlayer setup --force`. Then pin Y and restart: published image `docker compose pull && docker compose up -d --remove-orphans`; git checkout `git checkout <Y>` then `docker compose down --remove-orphans` and `up -d --build --remove-orphans`. Confirm `/health` and `secondlayer verify all --against <manifest>`. To roll back, pin X: the schema stays migrated, so only the image rolls back.",
		),
	],

	"/docs/devnet": [
		card(
			"Spin up local devnet",
			"Point a Clarinet project at a local Secondlayer stack.",
			"/secondlayer From inside my Clarinet project, run `secondlayer devnet connect` — explain that it patches `settings/Devnet.toml` to forward events to the local indexer on `:3700`, writes `.secondlayer/docker-compose.yml`, and brings the stack up. Then start the chain with `clarinet devnet start` and confirm the api is live at `curl http://localhost:3800/health`.",
		),
		card(
			"Deploy against devnet",
			"Run a subgraph on local devnet blocks.",
			"/secondlayer Help me deploy a subgraph against my local devnet: export `SECONDLAYER_API_URL=http://localhost:3800` and `INSTANCE_TOKEN=dev-instance-token`, then `secondlayer subgraphs deploy ./subgraph.ts` — the generated devnet stack ships that fixed local token, and deploys are writes, so they carry it. Then have me fire a contract call in the devnet and confirm the matching rows land by reading the subgraph's table with plain `curl $SECONDLAYER_API_URL/v1/subgraphs/<name>/<table>`: the stack publishes the api on loopback, so `/v1` reads need no token.",
		),
		card(
			"Watch and tear down",
			"Snapshot ingest, tail logs, then wipe the stack.",
			"/secondlayer Walk me through watching the local stack: `secondlayer devnet status -w` for live ingest lag and recent rows, `secondlayer devnet logs indexer -f` to tail one service, then `secondlayer devnet down` to stop — or `secondlayer devnet down --purge` to wipe the local index volumes when I'm done.",
		),
	],

	"/docs/migrate-chainhook": [
		card(
			"Convert my predicate",
			"Map a Chainhook predicate to webhook triggers.",
			"/secondlayer I'm moving from Hiro Chainhook to Secondlayer webhooks. I'll paste my predicate JSON — map each `if_this` scope to the matching `trigger.*` factory (`contract_call`→`trigger.contractCall`, `print_event`→`trigger.printEvent`, `ft_event`/`nft_event`/`stx_event`→the mint/transfer/burn factories, `contract_deployment`→`trigger.contractDeploy`), carry over `contract_identifier`/`method`/wildcards and any `trait` scope, and build one `sl.webhooks.create({ name, url, triggers })` call. Flag any scope with no direct trigger — like `txid`, which I query on `/v1/index` instead.",
		),
		card(
			"Backfill predicate history",
			"Replace a predicate's start_block with replay.",
			"/secondlayer Chainhook predicates scan from a `start_block`; a Secondlayer webhook starts at the chain tip. Help me deliver the history I'm missing with `replay` over an existing webhook — explain that it's idempotent, capped at 100,000 blocks, and never moves the live cursor — then give me the exact call for the block range I name.",
		),
		card(
			"Verify deliveries",
			"Swap bearer-token auth for signature verification.",
			"/secondlayer In Chainhook I authed webhooks with a bearer token; on Secondlayer the signature is the auth. Help me verify every delivery with `verifyWebhookSignature` from `@secondlayer/sdk` before I process it, then handle the `chain.{type}.apply` and `chain.reorg.rollback` envelopes so I undo anything I committed off an orphaned block.",
		),
		card(
			"Move a self-hosted v1 stack",
			"Run the indexer against your own node, same API.",
			"/secondlayer I was running self-hosted Chainhook (v1). Help me stand up the Secondlayer indexer against my own Stacks node instead: point the node's `events_observer` at the indexer on `:3700`, then create webhooks with the same `sl.webhooks.create` API. Same triggers, my infrastructure.",
		),
	],
};

/** Last-resort default for an unknown slug — every real docs page has its own
 *  set above, so this should never render in practice. */
const DEFAULT_CARDS: DocsAgentCard[] = DOCS_AGENT_CARDS["/docs"];

export function docsAgentCards(slug: string): DocsAgentCard[] {
	return DOCS_AGENT_CARDS[slug] ?? DEFAULT_CARDS;
}
