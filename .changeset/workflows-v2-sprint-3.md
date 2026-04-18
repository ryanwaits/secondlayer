---
"@secondlayer/stacks": minor
"@secondlayer/workflows": minor
"@secondlayer/bundler": patch
---

Workflows v2 — Sprint 3: Stacks SDK pillar (tools, triggers, tx builders).

**New subpaths on `@secondlayer/stacks`:**

- **`/tools`** — 12 AI-SDK-compatible read tools: `getStxBalance`, `getAccountInfo`, `getBlock`, `getBlockHeight`, `readContract`, `estimateFee`, `bnsResolve`, `bnsReverse`, plus Hiro-extended reads `getTransaction`, `getAccountHistory`, `getMempoolStats`, `getNftHoldings`. Each is a `tool()` from `ai@^6` with a Zod input schema and typed execute. Both bare exports (zero-config, uses `STACKS_RPC_URL` / `STACKS_CHAIN` env) and a `createStacksTools(client)` factory for custom clients.

- **`/tools/btc`** — 5 Bitcoin read tools via mempool.space: `btcConfirmations`, `btcBalance`, `btcUtxos`, `btcFeeEstimate`, `btcBlockHeight`. Override the endpoint with `BTC_MEMPOOL_URL`.

- **`/triggers`** — typed `on.*` helpers for all 13 `SubgraphFilter` variants (`stxTransfer`, `stxMint`, `stxBurn`, `stxLock`, `ftTransfer`, `ftMint`, `ftBurn`, `nftTransfer`, `nftMint`, `nftBurn`, `contractCall`, `contractDeploy`, `printEvent`). Each returns a `TypedEventTrigger<TEvent>` whose phantom `__event` marker drives handler-event inference in `defineWorkflow`.

- **`/tx`** — `tx.transfer`, `tx.contractCall`, `tx.deploy`, `tx.multisend`. Factory functions returning `TxIntent` objects — unsigned descriptions of what to broadcast. The `broadcast()` primitive (Sprint 4) consumes these, resolves fee/nonce/signer, and submits.

**`defineWorkflow` now infers handler event type** from the trigger's phantom `__event` marker. A workflow triggered by `on.stxTransfer(…)` sees `event: StxTransferEvent` (with typed `sender`, `recipient`, `amount`, `tx`) in the handler — no casting needed. Untyped triggers (`{ type: "schedule" }`, raw filter literals) continue to see `Record<string, unknown>` as before.

**Bundler regression coverage:** new test exercises a workflow that imports from `/triggers` + `/tx` + uses the narrowed handler event. Proves the Sprint 2.5 util-bug fix holds across the Sprint 3 surface.
