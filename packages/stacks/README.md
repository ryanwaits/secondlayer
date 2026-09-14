# @secondlayer/stacks

A viem-style SDK for the Stacks blockchain. One package, zero polyfills, full tree-shaking.

Docs: [stacks.secondlayer.tools](https://stacks.secondlayer.tools)

## Install

```bash
bun add @secondlayer/stacks
```

## Quick Start

```ts
import { createPublicClient, http } from "@secondlayer/stacks";
import { mainnet } from "@secondlayer/stacks/chains";

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
});

const balance = await client.getBalance({
  address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
});
```

## Exports

| Module | Description |
|---|---|
| `@secondlayer/stacks` | Clients, transports, re-exports |
| `@secondlayer/stacks/accounts` | `privateKeyToAccount`, `mnemonicToAccount`, wallet providers |
| `@secondlayer/stacks/chains` | `mainnet`, `testnet`, `devnet`, `defineChain` |
| `@secondlayer/stacks/clarity` | `Cl.*` constructors, serialization, ABI type system |
| `@secondlayer/stacks/actions` | `readContract`, `callContract`, `transferStx`, `getContract`, `multicall` |
| `@secondlayer/stacks/transactions` | Build, sign, serialize transactions, multi-sig |
| `@secondlayer/stacks/postconditions` | `Pc` fluent builder for post-conditions |
| `@secondlayer/stacks/utils` | Encoding, hashing, addresses, unit formatting |
| `@secondlayer/stacks/bitcoin` | Trust-minimized Bitcoin SPV — proof construction, Clarity codecs, verifier (SIP-044) |
| `@secondlayer/stacks/pox5` | PoX-5 Bitcoin Staking (SIP-045) — bonds, staking, lockup scripts, signer grants |
| `@secondlayer/stacks/sbtc` | `sbtc()` client extension: sBTC deposits, balances, withdrawals |
| `@secondlayer/stacks/filters` | Event and transaction filter builders, re-exported from the root |
| `@secondlayer/stacks/simnet` | Clarinet simnet transport — same `getContract` client against an in-process VM |

### Frozen modules

These ship and work but get no further investment — they may be removed in a
future major. Prefer Hiro's maintained `@stacks/*` ecosystem for wallet-side
work; Secondlayer is a data-infrastructure company, not a wallet SDK vendor.

Nonce coordination is the exception — it is supported and maintained:
it's mempool-aware (built on Secondlayer's data plane) and solves a real
multi-broadcast gap, which is why it lives here rather than being deferred to
`@stacks/*`.

| Module | Description |
|---|---|
| `@secondlayer/stacks/connect` | Wallet connection — browser extensions + `setProvider` |
| `@secondlayer/stacks/connect/walletconnect` | WalletConnect v2 — native relay, QR, modal |
| `@secondlayer/stacks/subscriptions` | WebSocket watch helpers (`watchBlocks`, `watchMempool`, `watchTransaction`) — not a Webhooks product alias |
| `@secondlayer/stacks/bns` | BNS name registration, resolution, zonefiles |
| `@secondlayer/stacks/pox` | PoX stacking — solo and delegated |
| `@secondlayer/stacks/stackingdao` | StackingDAO liquid staking (STX/stSTX) |

Agent Stacks reads go through [`@secondlayer/mcp`](https://www.npmjs.com/package/@secondlayer/mcp).

## Guides

- [Clarinet simnet](https://stacks.secondlayer.tools/guide/simnet)
- [Fee tiers](https://stacks.secondlayer.tools/guide/fees)
- [Wait for confirmation](https://stacks.secondlayer.tools/guide/confirmation)
- [Errors](https://stacks.secondlayer.tools/guide/errors)
- [Bitcoin addresses](https://stacks.secondlayer.tools/guide/bitcoin-addresses)
- [PoX-5 Bitcoin Staking](https://stacks.secondlayer.tools/guide/pox5)
- [Nonce management](https://stacks.secondlayer.tools/guide/nonces)
- [Bitcoin SPV](https://stacks.secondlayer.tools/guide/bitcoin-spv)
- [WalletConnect v2](https://stacks.secondlayer.tools/guide/walletconnect)
- [Bundle size](https://stacks.secondlayer.tools/)
