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

- [x] **W1 Sponsor hot wallet** (pays STX gas on every settle): create a FRESH mainnet
      wallet, never used elsewhere. Fund with **~200 STX** to start (sponsored transfer
      gas ≈ 0.003–0.01 STX → tens of thousands of settles; top up later, don't park more
      on a hot key). Record the principal here: `SP1BZXJWQ81N8M4AHKCHR2FNF4JPPFKB1DRWC0ZHP`
- [x] **W2 Pay-to treasury** (receives all x402 revenue): SEPARATE wallet from W1 —
      revenue must not sit on the hot key. Hardware-backed or multisig preferred; it
      only ever RECEIVES, so cold is fine. Principal: `SP143YHR805B8S834BWJTMZVFR1WP5FFC03WZE4BF`
- [x] **W3 Custody decisions** (write answers inline):
      - Where does W1's private key live besides the server .env? **Offline, written down (paper).**
      - Sweep policy: **Untouched for now** (accumulate); revisit once operational + properly set up.
      - Sponsor refill trigger: **Alert when W1 < 25 STX** → becomes the M1 threshold.
- [x] **W4 Test payer wallet**: a third wallet holding small amounts of all three tokens
      (~$5 USDCx, ~$5 sBTC, ~20 STX) for smoke tests. AGENT can generate the keypair
      (`privateKeyToAccount` via bun script); FOUNDER funds it. Principal: `SP39Z29ZPN65Q9Z2CJX8PRFR5V36PMSMQ607HHF5W`
      (key in gitignored `tmp/x402-w4-testpayer.secret.txt`; agent reads it at Phase 3, never prints it)

## Phase 2 — Env + flip (AGENT executes, FOUNDER supplies secrets out-of-band)

- [x] **E1** FOUNDER added to `/opt/secondlayer/docker/.env` (server-side): `X402_SPONSOR_KEY`,
      `X402_PAY_TO=SP143YHR…`, `X402_SPOT_STX_USD=0.218876` (sBTC fallback omitted — not testing sBTC).
      ⚠️ `0.218876` looks like a typo for live ~`0.178876` (see E3 finding — fallback is the
      *de-facto* STX price in prod, so fix it).
- [x] **E2** AGENT done via full `deploy.sh` run (new replicas api-134/135). ⚠️ DOC WAS WRONG:
      `docker restart` does NOT pick up new env (baked at container-CREATE) — containers must be
      RECREATED. Verified env in api-134/135 (`X402_SPONSOR_KEY` len 66, `X402_PAY_TO`, spot set).
      Worker x402 env MISSING but HARMLESS: the reconciler cron is read-only (decoded_events +
      Redis), does NOT gate on `isX402Enabled()` or need the sponsor key. Enable switch lives on
      the api, which has it. (compose does NOT forward x402 vars to worker — doc's "wired for
      worker" was false, but it doesn't matter.)
- [x] **E3** AGENT: flip confirmed — `GET /v1/x402/supported` → `enabled:true`, all 5 surfaces
      priced. Live 402 on `/v1/streams/stx-transfers`: `accepts[]` = STX (amount 4569µ) + USDCx
      (1000µ=$0.001), `payTo`=W2 ✓, nonce issued. **FINDING (non-blocking): live CoinGecko spot
      does NOT resolve in prod** — in-process cache never warms (same replica, repeated probes,
      all pinned to env fallback) though curl+Bun-fetch to CoinGecko from the container both 200.
      → STX prices off env fallback (0.218876, ~22% over live 0.179); sBTC dropped from offer (no
      fallback set). Likely cause: `spot.ts refresh()` silent-catches + never bumps `fetchedAt` on
      failure → every request re-fires refresh → self-inflicted CoinGecko rate-limiting. FOLLOW-UP
      (separate fix, not activation): (a) throttle/log refresh failures, (b) set sBTC fallback,
      (c) correct STX fallback to live. Does NOT block STX smoke ladder.

## Phase 3 — Smoke ladder (AGENT executes with W4 key; FOUNDER watches)

> ⛔ **BLOCKED on the spot-feed fix** (founder ruling 2026-06-12): live CoinGecko spot
> doesn't resolve in prod (E3 finding) → STX mispriced + sBTC unpriceable. Resolve via
> `docs/sprints/x402-spot-feed-fix-kickoff.md` BEFORE starting S1. Root cause confirmed:
> CoinGecko 429s after ~5 rapid calls + `spot.ts refresh()` never advances `fetchedAt` on
> failure → permanent retry storm. Un-pause at that doc's T9.

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

- [ ] **M1** Sponsor-balance watch: new worker cron `sponsor-balance-alert.ts` modeled on
      `spend-cap-alert.ts` (interval tick; check W1 balance; alert when < 25 STX). DECISION:
      reuse the existing **email** alert path (no Slack/Discord infra exists today). W1 =
      `SP1BZXJWQ81N8M4AHKCHR2FNF4JPPFKB1DRWC0ZHP`. (This is the rail's single point of failure.)
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
