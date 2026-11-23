<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/hero-dark.svg">
    <img alt="Secondlayer: Instant data for apps on Bitcoin. Every Stacks block, decoded from genesis and delivered at tip." src=".github/assets/hero-light.svg" width="100%">
  </picture>
</p>

<p align="center">
  <a href="https://www.secondlayer.tools/signin"><b>Start free</b></a> ·
  <a href="https://www.secondlayer.tools/docs">Docs</a> ·
  <a href="https://www.secondlayer.tools/pricing">Pricing</a> ·
  <a href="#self-host">Self-host</a>
</p>

## What you can do with it

- **Know what changed in any Stacks contract, when, and who changed it.** Every map and variable write, with the transaction that made it. From block 1. Nowhere else on Stacks.
- **Turn your contract into a table you query.** One TypeScript file becomes a schema, tables and a REST API, backfilled from genesis.
- **Hear about it first.** Name the chain events, give us a URL. Signed, retried, logged.
- **Check it yourself.** Prove any block your rows came from back to Bitcoin, without trusting us.

## Install

```bash
bun add -g @secondlayer/cli
```

Then sign in with `secondlayer login`, or [self-host](#self-host) with no key at all.

## Products

| | What it is | Use it when |
|---|---|---|
| **Index** | Every Stacks event, already decoded, from block 1. Includes contract state writes. | You want rows now, by contract, event or block. |
| **Streams** | Exactly what the Stacks node emitted, in order, from any block. | You build your own indexer and want the raw feed. |
| **Subgraphs** | Your contract, as a table you query. | Your app screens need positions, balances, history. |
| **Webhooks** | Your server, told first. | Something should happen the moment the chain moves. |
| **Archive** | Signed history. Check your copy free, repair only what's broken. | You self-host and want genesis without a six-week replay. |

## Start in two minutes

**1. Sign up.** [secondlayer.tools/signin](https://www.secondlayer.tools/signin): email code, no card.

**2. Get a key.** Make one under **Account → Keys** and export it as `SECONDLAYER_API_KEY`. The CLI signs in with:

```bash
secondlayer login
```

**3. Read.** Who changed this contract, and what they changed:

```bash
curl -H "Authorization: Bearer $SECONDLAYER_API_KEY" \
  "https://api.secondlayer.tools/v1/index/state-writes?contract_id=SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-dao&tx_context=true&limit=5"
```

Or from TypeScript:

```ts
import { SecondLayer } from "@secondlayer/sdk";

// An sk-sl_ key points the client at api.secondlayer.tools.
const sl = new SecondLayer({ apiKey: process.env.SECONDLAYER_API_KEY });
const { state_writes } = await sl.index.stateWrites.list({
  contractId: "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-dao",
  txContext: true,
});
```

> **1M rows free every month.** Then $5 per 1M rows, same price live or history. [Pricing →](https://www.secondlayer.tools/pricing)

<details>
<summary>What contract state does and doesn't cover</summary>

- The current value of one key was always readable from a node. What's new is every past write and who made it.
- Rows exist after a transaction lands. It warns, it doesn't prevent. A transaction that fails outright leaves no rows.
- Stored values and calls between contracts, not every intermediate value in the code.
- State writes are checkable against the block's state root. Inner calls are not committed on chain.

</details>

## Self-host

Same API, your Postgres, your box. MIT, free forever.

```bash
git clone https://github.com/ryanwaits/secondlayer
cd secondlayer/docker/oss
secondlayer init --network mainnet
docker compose up -d
```

Point it at a Stacks node you run, then pull history from the signed Archive instead of replaying it. [Self-host guide →](https://www.secondlayer.tools/docs/self-host) · [Compose reference](docker/oss/README.md)

## Packages

| Package | |
|---|---|
| [`@secondlayer/cli`](packages/cli/README.md) | `secondlayer` binary: login, deploy, verify |
| [`@secondlayer/sdk`](packages/sdk/README.md) | TypeScript client for Index, Streams, Subgraphs, Webhooks |
| [`@secondlayer/mcp`](packages/mcp/README.md) | MCP server, 50 tools |
| [`@secondlayer/subgraphs`](packages/subgraphs/README.md) | `defineSubgraph()`: schema, triggers, handlers |
| [`@secondlayer/verify`](packages/verify/README.md) | Check a Stacks block yourself |
| [`@secondlayer/stacks`](packages/stacks/README.md) | viem-style Stacks client |

## Contributing

```bash
bun install
bun run db          # Postgres on 127.0.0.1:5440
bun run migrate
bun run build
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5440/secondlayer bun run test
```

Releases go through [Changesets](https://github.com/changesets/changesets): `bun run version`, then `bun run release`. The hero image is generated: `bun run readme-hero` in `apps/web`.

MIT licensed.
