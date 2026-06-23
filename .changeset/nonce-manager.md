---
"@secondlayer/stacks": minor
---

Add `createNonceManager` for mempool-safe sequential nonces across rapid broadcasts.

Wallet actions (`transferStx`, `callContract`, `deployContract`, `sponsorTransaction`, multisig) now resolve nonces through an optional client-level `nonceManager` instead of always reading the confirmed `/v2/accounts` nonce — so broadcasting many transactions back-to-back from one account no longer collides (`ConflictingNonceInMempool`).

- `createNonceManager({ source?, store? })` — viem-style manager with `consume`/`reset`.
- `jsonRpcSource()` — node-agnostic confirmed-nonce floor (default; no Hiro dependency).
- `memoryStore()` — in-memory, per-address-serialized allocation (default; single-process).
- `redisStore({ redis })` / `postgresStore({ sql })` — durable, cross-process stores for multi-builder / smart-wallet-as-a-service deployments. The atomic reserve lives in the datastore (Redis `EVAL`/`INCR`, Postgres upsert under a row lock), so it doubles as the cross-process lock and survives restarts. Dependency-injected — pass your own `Bun.redis`/`Bun.sql` client; no global `Bun` reference.
- On a nonce-conflict broadcast rejection, the manager resets and re-syncs to the confirmed floor (dropped-tx / reorg recovery).

Wire it via `createWalletClient({ ..., nonceManager: createNonceManager() })`. Passing an explicit `nonce` still bypasses the manager.
