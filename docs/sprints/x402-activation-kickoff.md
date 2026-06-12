# x402 Rail Activation — Session Kickoff

> Paste into a fresh session: "Read docs/sprints/x402-activation-kickoff.md and walk me
> through it as an interactive checklist. I'll do the FOUNDER items and tell you when
> each is done; you execute every AGENT item yourself, verify it, and check it off in
> this file as we go."

## Context (read first, trust this over memory)

The x402 pay-per-call rail is FULLY BUILT and deployed dormant. Everything below is
live code in prod, waiting on env vars:

- **Enable switch**: `isX402Enabled()` = `Boolean(process.env.X402_SPONSOR_KEY)`
  (packages/api/src/x402/facilitator.ts:357). Setting the key in the server `.env` and
  restarting the api replicas IS the flip. Compose already passes through:
  `X402_SPONSOR_KEY`, `X402_PAY_TO`, `X402_SPOT_URL`, `X402_SPOT_SBTC_USD`,
  `X402_SPOT_STX_USD` (docker-compose.yml:138+).
- **What turns on**: per-call 402s on `/v1/index/*` (after 1,000/day/IP free quota) and
  `/v1/streams/*` (sessions: $0.001 buys 500 calls/1h); paid subgraph deploys
  (POST /v1/subgraphs, $2, confirmed-tier, 7-day TTL) + renewals ($0.50/wk); prepaid
  deposits ($0.25–$100) with PAYMENT-BALANCE drawdowns + SDK auto-topUp; wallet→account
  linking. Tokens: STX, sBTC, USDCx (USDCx = $1 peg, no oracle; STX/sBTC need spot).
- **Architecture**: we are the facilitator — `X402_SPONSOR_KEY` is a HOT mainnet key
  that sponsors STX gas on every settle; `X402_PAY_TO` receives the payments. Optimistic
  tier for reads (velocity 120/min per principal + Redis strikes, fails closed to
  confirmed); confirmed tier for writes/deposits. Reconciler cron (worker) confirms
  optimistic settles via our own decoded_events. Nonce store = Redis, fail-closed.
- **Already satisfied**: SECONDLAYER_SECRETS_KEY (session/balance vouchers), Redis,
  migrations 0091–0099, the reconciler, all discovery surfaces
  (/v1/x402/supported, /.well-known/x402, llms.txt, OpenAPI x-x402, MCP capabilities).
- **Smoke tooling**: `scripts/` has a mainnet x402 smoke script (commit 317a6b01) with
  `X402_TEST_ASSET` override (b7cb18f1) — find and read it before Phase 3.
- **Known judgment calls**: `enabled:false` in /v1/x402/supported is correct UNTIL the
  flip; after it, `enabled:true` becomes the prod-smoke expectation —
  `.claude/skills/prod-smoke/SKILL.md` Phase 3 note must be updated (Phase 5 below).
- **Kill switch**: blank `X402_SPONSOR_KEY` in server .env + `docker restart` both api
  replicas (never raw `compose up` — see docker/PRODUCTION.md rules). Rail returns 503
  PAYMENT_RAIL_UNAVAILABLE on paid writes and free-quota-only on reads.

## Phase 1 — Wallets & policy (FOUNDER, with agent advising)

- [ ] **W1 Sponsor hot wallet** (pays STX gas on every settle): create a FRESH mainnet
      wallet, never used elsewhere. Fund with **~200 STX** to start (sponsored transfer
      gas ≈ 0.003–0.01 STX → tens of thousands of settles; top up later, don't park more
      on a hot key). Record the principal here: `SP_________________`
- [ ] **W2 Pay-to treasury** (receives all x402 revenue): SEPARATE wallet from W1 —
      revenue must not sit on the hot key. Hardware-backed or multisig preferred; it
      only ever RECEIVES, so cold is fine. Principal: `SP_________________`
- [ ] **W3 Custody decisions** (write answers inline):
      - Where does W1's private key live besides the server .env? (password manager entry name: ______)
      - Sweep policy: treasury untouched / swept to ___ at what threshold? ______
      - Sponsor refill trigger: alert when W1 < ___ STX (suggest 25)? ______
- [ ] **W4 Test payer wallet**: a third wallet holding small amounts of all three tokens
      (~$5 USDCx, ~$5 sBTC, ~20 STX) for smoke tests. AGENT can generate the keypair
      (`privateKeyToAccount` via bun script); FOUNDER funds it. Principal: `SP_________________`

## Phase 2 — Env + flip (AGENT executes, FOUNDER supplies secrets out-of-band)

- [ ] **E1** FOUNDER adds to `/opt/secondlayer/docker/.env` (paste key directly on the
      server, never through chat): `X402_SPONSOR_KEY=<W1 key>`, `X402_PAY_TO=<W2 principal>`,
      `X402_SPOT_SBTC_USD=<current>`, `X402_SPOT_STX_USD=<current>` (static fallbacks;
      live feed default is CoinGecko via X402_SPOT_URL unset).
- [ ] **E2** AGENT: verify env reaches containers after restart — `docker restart` both
      api replicas + worker (reconciler), one at a time (rolling; never both api at once).
      `printenv X402_SPONSOR_KEY` inside a replica must be non-empty. REMINDER: per-service
      `environment:` blocks only pass listed vars — already wired for api + worker.
- [ ] **E3** AGENT: confirm the flip — `GET /v1/x402/supported` → `enabled: true`, all 5
      catalog surfaces priced, accepts[] quotes present for all three tokens (sBTC/STX
      appear ONLY if spot resolves — verify, don't assume).

## Phase 3 — Smoke ladder (AGENT executes with W4 key; FOUNDER watches)

Run in order; each step gates the next. Use the existing mainnet smoke script where it
fits; otherwise SDK calls (`withX402`, `readX402Receipt`, `balanceToken`).

- [ ] **S1 Per-call read (optimistic)**: burn the free quota OR hit `/v1/streams/*`
      keyless → 402 → pay with USDCx → 200 + PAYMENT-RESPONSE receipt
      (state=optimistic) → row lands in `x402_payments` (state pending) → reconciler
      confirms it within its cycle (watch worker logs).
- [ ] **S2 Session**: same call again → PAYMENT-SESSION header returned → replay voucher
      → free rides; verify session caps (calls counted in Redis).
- [ ] **S3 Token matrix**: repeat S1 once each with STX and sBTC (spot-priced quotes).
- [ ] **S4 Deposit + drawdown**: POST /v1/x402/deposit?usd=1 (confirmed-tier — takes a
      block or two) → balance_token returned → drawdown a read via PAYMENT-BALANCE →
      X-BALANCE-REMAINING-USD decrements → GET /v1/x402/balance matches.
- [ ] **S5 Paid deploy**: tiny insert-only subgraph via x402 ($2, confirmed) → wallet-ghost
      account created, expires_at = +7d, forward-only (genesis clamp) → reads work →
      renew ($0.50) extends expiry → POST /api/wallet/link from a claimed account adopts
      it (continuity E2E).
- [ ] **S6 Guards under fire**: velocity (rapid-fire optimistic settles from one principal
      → confirmed-tier downgrade after 120/min), replayed nonce → rejected, malformed
      PAYMENT-SIGNATURE → 402 not 500, deposit below $0.25 → 422.
- [ ] **S7 Ledger audit**: every smoke settle visible in `x402_payments` with correct
      kind/state/payer; no orphans; W2 received the sums; W1 gas spend ≈ expected.

## Phase 4 — Monitoring & ops (AGENT builds, FOUNDER approves)

- [ ] **M1** Sponsor-balance watch: extend the secondlayer-agent (or worker cron) to
      alert Slack when W1 < 25 STX. (This is the rail's single point of failure.)
- [ ] **M2** prod-smoke skill: update Phase 3 x402 note (enabled:true now expected; add
      "sponsor balance ≥ floor" + "reconciler: 0 stuck pending > 1h" checks).
- [ ] **M3** PRODUCTION.md: add x402 section — kill switch procedure, key rotation
      procedure, reconciler stuck-pending diagnosis, velocity-gate tuning envs.
- [ ] **M4** Decide optimistic-loss tolerance: reverted-after-serve rate is visible in
      x402_payments (state reverted) — set a review cadence (weekly?) before tuning.

## Phase 5 — Announce (FOUNDER decides scope)

- [ ] **A1** Pricing page: x402 footer card drops "Experimental" (or keeps it — founder
      call); copy already matches the real wire.
- [ ] **A2** Memory/docs: agent updates project memory (rail LIVE, date, wallet
      principals' last-4, policies from W3) + marks the focus-audit "dormant" ruling
      superseded by founder decision.
- [ ] **A3** Optional: AIBTC outreach (the discovery surfaces are what their tooling
      crawls — this was the original Wave-1 BD trigger).

## Hard rules for the session
- Private keys NEVER pass through chat, files, or commits — founder pastes server-side.
- Every phase-3 step that fails: stop the ladder, diagnose, fix, restart that step.
- Any code change ships through /check → changeset → /release (subgraphs+api same train).
- The flip is reversible at any moment via the kill switch; when in doubt, flip off.
