---
"@secondlayer/workflows": minor
"@secondlayer/stacks": minor
"@secondlayer/shared": minor
"@secondlayer/bundler": minor
"@secondlayer/cli": minor
---

Workflows v2 — Sprint 4: chain writes via customer-owned Remote Signer.

Workflows can now broadcast Stacks transactions without Secondlayer holding any private key. The runner POSTs unsigned tx + context to a customer-hosted HTTPS endpoint, the customer signs, the runner submits.

**`@secondlayer/workflows`:**
- New `signers: Record<string, SignerConfig>` field on `WorkflowDefinition`
- New `signer.remote({ endpoint, publicKey, hmacRef, timeoutMs? })` factory — `hmacRef` names a secret stored separately (see `sl secrets`) so rotation doesn't require redeploy

**`@secondlayer/stacks`:**
- New `broadcast(intent, { signer, maxMicroStx?, maxFee?, awaitConfirmation? })` — submits a `TxIntent` via the workflow-declared signer. Returns `{ txId, confirmed }` (confirmation polling lands Sprint 5)
- New `broadcastContext` AsyncLocalStorage — runner scopes the `BroadcastRuntime` per run; concurrent runs don't share state
- New error taxonomy: `TxRejectedError` (reason union + `isRetryable`), `TxTimeoutError`, `TxSignerRefusedError`

**`@secondlayer/shared`:**
- New `@secondlayer/shared/crypto/secrets` — AES-256-GCM envelope (`encryptSecret` / `decryptSecret` / `generateSecretsKey`). Key from `SECONDLAYER_SECRETS_KEY` env
- New `workflow_signer_secrets` table via migration `0034`

**`@secondlayer/bundler`:**
- Deploy-time lint: flags `broadcast()` calls lexically inside a `tool({...})` body that lack `maxMicroStx` + `maxFee` OR `postConditions`. Escape hatch: `// @sl-unsafe-broadcast` comment on the broadcast line. Protects against AI-drainable toolsets.

**`@secondlayer/cli`:**
- New `sl secrets list|set|rotate|delete` commands. `set` and `rotate` prompt for the value via masked input if not supplied on the command line

**New package `@secondlayer/signer-node`:**
- Customer-hosted reference signer service. `createSignerService({ privateKeyHex, hmacSecret, policy })` returns a Hono app; mount on any Fetch-compatible runtime (Bun, Deno, Cloudflare Workers, Node via `@hono/node-server`)
- Policy helpers: `allowlistFunctions`, `dailyCapMicroStx`, `requireApproval`, `composePolicies`, `denyAll`
- Railway example under `packages/signer-node/examples/railway/`

**API:**
- New `/api/secrets` routes — list / upsert / delete per-account. Values AES-encrypted at rest; never returned to clients.

**Migrations required:** `0034_workflow_signer_secrets` before runner restart.

**Runtime env added:** `SECONDLAYER_SECRETS_KEY` (32-byte hex, generate with `openssl rand -hex 32`). API + runner both need it to en/decrypt. Without it, `sl secrets set` and broadcast both error at call-site.

**Sprint 4 scope limits (expand later):**
- `broadcast` supports `TransferIntent` + `ContractCallIntent` only; `DeployIntent` + `MultiSendIntent` throw "not yet implemented"
- `awaitConfirmation: true` is a no-op in Sprint 4; Sprint 5 wires subgraph pg_notify confirmation polling
- Default fee: 10k µSTX when `maxFee` isn't supplied. No fee estimation yet — Sprint 5 will add estimateFee-driven defaults.
