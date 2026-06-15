# Secondlayer Capabilities — What We Can Build With

The inventory of secondlayer products, packages, surfaces, and unfair advantages. Map every
opportunity to one or more concrete capabilities below. If an opportunity can't be tied to
something here, it is out of scope (note it as "adjacent / not ours" instead of inventing a tool).

## Table of contents
- Three core products
- Installable packages & CLI
- Public surfaces (API endpoints)
- Domain concepts handled
- The Hiro gap (our moat)
- Differentiating tech

## Three core products

1. **Index** — decoded chain data as-a-service. Queryable decoded Stacks events: FT/NFT/STX
   transfers, contract calls, `print_event` logs, **sBTC peg lifecycle**, **PoX reward cycles**.
   Surface: REST `/v1/index/*`, **keyless** (no account/key for reads). For app devs, agents,
   dashboards.
2. **Subgraphs** — your schema on our indexer. Deploy one TypeScript file (`defineSubgraph()` +
   event sources + handlers + schema) → managed Postgres tables behind `/v1/subgraphs/*`. No node
   required. Genesis backfill (Pro). The revenue core. For teams building app-specific chain views.
3. **Streams** — raw signed event firehose. Cursor-paginated REST + SSE tail + ed25519-signed
   parquet archive. Reorg-aware, resumable, replay from any height. For data/infra engineers
   building their own indexers/ETL.

Features (not products): Subscriptions (webhooks on Index/Streams/Subgraphs), Explore (public
subgraph directory), Contract discovery (`/v1/contracts` trait filtering).

## Installable packages & CLI

| Package | Binary | Does | Users |
|---|---|---|---|
| `@secondlayer/cli` | `sl` | auth, projects, subgraph scaffold/deploy/query, Clarity codegen, subscriptions, data reads | engineers/ops |
| `@secondlayer/sdk` | — | TS client: query Index/Streams/Subgraphs, manage subscriptions, verify signatures | app code |
| `@secondlayer/stacks` | — | viem-style Stacks SDK: contract reads, transfers, Clarity decoding, BNS, PoX, accounts, WalletConnect v2 | app devs |
| `@secondlayer/mcp` | `secondlayer-mcp` | MCP server (scaffold + query for agents) | AI agents |
| `@secondlayer/subgraphs` | — | `defineSubgraph()` DSL + declarative schema | subgraph authors |

Golden-path commands:
```bash
sl login
sl projects create my-app && sl projects use my-app
sl subgraphs scaffold SP….contract -o subgraphs/x.ts
sl subgraphs deploy subgraphs/x.ts --start-block <recent>
sl subgraphs query x <table> --sort _block_height --order desc
sl subscriptions create hook --subgraph x --table <t> --url https://…
sl index ft-transfers --contract-id SP….token --limit 5
sl streams tip
sl contracts generate ./contracts/*.clar -o src/generated.ts   # Clarity → typed TS + React hooks
```

## Public surfaces (API)

- `/v1/index/*` — keyless decoded data (ft/nft/stx transfers, events, contract calls, `sbtc/*`, `pox/cycles`)
- `/v1/streams/*` — raw firehose (bearer token, Build+ tier)
- `/v1/subgraphs/{subgraph}/{table}` — custom indexed tables
- `/v1/contracts` — contract discovery by trait
- `/api/*` — authed control plane (deploy/manage/admin)
- Webhooks `POST /webhooks` — signed (Standard Webhooks HMAC + universal ed25519)
- OpenAPI at `/v1/openapi.json` + per-subgraph specs
- Console at **secondlayer.tools** (Next.js): keys, projects, subscriptions, billing

## Domain concepts handled

- **Events**: `ft_transfer`, `nft_transfer`, `stx_transfer/mint/burn/lock`, `contract_call`,
  `contract_deploy`, `print_event`, **sBTC** (`sbtc_deposit_created`, `sbtc_withdrawal_finalized`, …)
- **PoX** reward-cycle aggregates by cycle
- **Traits/SIPs**: SIP-009 (NFT), SIP-010 (FT), SIP-013 (semi-fungible); trait-based discovery
- **Chain primitives**: block height/hash, tx_id, canonical status, **reorg detection & rollback**,
  **finalized height** (Bitcoin-anchored, ~70% signer weight), tx inclusion proofs (signer consensus)
- **Clarity**: ABI parsing, type-safe calldata builders, post-conditions, contract reads, codegen

## The Hiro gap (our moat)

"Decoded Stacks data Hiro won't build." Where we beat the primary Stacks API provider:

| Capability | Us | Hiro |
|---|---|---|
| Decoded sBTC peg lifecycle (typed `/v1/index/sbtc/*` + finality gating) | ✓ | ✗ (declined per roadmap) |
| PoX reward-cycle aggregates (`/v1/index/pox/cycles`) | ✓ | ✗ |
| Indexer-as-a-service / custom app schemas (Subgraphs) | ✓ | ✗ |
| Keyless reads | ✓ | ✗ (key required) |
| Genesis backfill in subgraphs | ✓ (Pro) | n/a |
| Node-free operation (hosted) | ✓ | ✗ (node if self-hosted) |
| Contract balances/nonces | ✗ (deferred) | ✓ |

When a signal exposes a Hiro gap, limitation, declined feature, or dev frustration with the Hiro
API → that is a **top-tier opportunity** (proven demand + clear differentiation).

## Differentiating tech (angles for content & proof-of-value)

- Subgraph hot-deploy (one `.ts` file → Postgres tables in seconds, no node)
- Cursor-keyset pagination (resumable, reorg-aware `<height>:<event_index>`)
- Polymorphic signed webhooks (subgraph rows OR raw events; ed25519 + HMAC)
- Automatic reorg rollback (checkpointed `consume()` / `walk()` loops)
- Verified delivery (signed manifests, signed SSE frames, signed webhooks) — provenance/audit story
- x402 (experimental) — pay-per-call with sBTC/USDCx/STX, agent-native, no signup
- Clarity codegen — contracts → typed TS interfaces + React hooks
