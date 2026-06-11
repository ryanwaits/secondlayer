# x402 agent-economy gaps — sequenced plan

Source: x402/agent scenario analysis 2026-06-10 (AIBTC archetype, S1–S5). Nine gaps + one BD track, ordered for one-at-a-time execution. Strategy: visibility first (be findable by agents that exist now), then economics correctness, then the two strategic builds, then surface expansion. Gap #9 added to cover the funnel leg of "the honest read" (wallet→account continuity); the AIBTC integration is a BD motion, tracked here but not a code gap.

Grounded structural facts (explored 2026-06-10):
- x402 middleware is METHOD-AGNOSTIC (only looks at PAYMENT-SIGNATURE) — paid POSTs need no middleware surgery, just a new `X402Surface` union member + `X402_PRICE_CATALOG` entry (packages/api/src/x402/catalog.ts:14,47-60) + per-route mount.
- Ledger `x402_payments` (migration 0091) records payer principal per receipt; NO balance concept today — credit = new table + drawdown path.
- Optimistic gate: per-principal velocity 120/min + Redis strikes; confirmed tier blocks until canonical. Paid WRITES should use confirmed-tier finality (no fraud window on something that allocates compute).
- MCP client builds SecondLayer with optional `fetchImpl` (packages/mcp/src/lib/client.ts:20-32) — `withX402` wraps there cleanly.
- No llms.txt anywhere; OpenAPI (routes/openapi.ts) never mentions x402.
- Subscriptions ownership = `account_id` FK + `getTenantScopedAccountId` (routes/subscriptions.ts:107-122) — decoupling = parallel owner column + lookup branch.
- TTL sweeper precedent: ghost-sweep.ts (daily cron, cutoff + EXISTS conditions, FK cascade). Ephemeral subgraphs reuse the pattern with `expires_at`.
- Genesis clamp (plan-limits.ts) already bounds accountless deploy compute to forward-only.

## Wave 1 — be findable (days, ship first)

### G4 · x402 discovery  (S)
- [ ] T1 `GET /v1/x402/prices` (public, no auth): per-surface price catalog as JSON — surface, priceUsd, assets w/ contract ids, finality tier, floor; derived from `X402_PRICE_CATALOG`, 200 even when rail off (`enabled: false` flag). → validates: route test + curl
- [ ] T2 Advertise in OpenAPI: `x-payment` extension on index/streams paths + a top-level `x402` info block in routes/openapi.ts. → validates: spec snapshot test
- [ ] T3 `apps/web` serves `/llms.txt` (and `/.well-known/x402` pointing at the prices endpoint): surfaces, auth model, x402 rail, MCP install, per-subgraph docs.md pattern. → validates: fetch + content check
- [ ] T4 MCP CAPABILITIES mentions the pay-per-call rail + prices endpoint. → validates: capabilities resource test

### G5 · MCP auto-pay  (S)
- [ ] T5 `X402_PRIVATE_KEY` env in MCP: when set, wrap the SDK client `fetchImpl` with `withX402(fetch, { account })` (packages/sdk/src/x402.ts withX402; client seam at mcp lib/client.ts). Log per-payment receipts at info. → validates: unit test w/ mocked 402 server; README + CAPABILITIES note
- [ ] T6 Surface receipts to the agent: tool responses append `x402_receipt` metadata when a call was paid (readX402Receipt). → validates: tool test
- changesets: mcp minor, docs touchpoints

## Wave 2 — economics correctness

### G6 · free-quota-then-402 ladder on Index  (M)
Today rail-on sends anonymous Index straight to 402, silently killing the keyless-reads story. Decision needed (founder): per-IP free quota size (suggest: reuse anon rate bucket, e.g. first N req/day/IP free, then 402 instead of 429).
- [ ] T7 Middleware order change on index mount only: anon limiter first; on exhaustion AND rail on → fall through to 402 challenge (else 429 as today). Streams unchanged (key-mandatory surface). → validates: route tests (under quota free, over quota 402 w/ rail, 429 w/o rail); pricing/docs copy already says "past the free limits" — becomes true

### G3 · Streams session pricing  (M/L)
Per-poll billing punishes politeness (~$43/day for a 2s poll loop). Bill per block-range consumed instead.
- [ ] T8 Design note: price per N blocks of events delivered (e.g. $0.001 per 100 blocks per filter), implemented as: paid request returns a `session` voucher (signed, TTL ~1h, block-range entitlement) honored by subsequent polls via header — only re-402s when the range is exhausted. Reuses nonce-store for voucher replay protection. Founder decision: price point + range size.
- [ ] T9 Implement voucher issue/verify in x402 middleware (streams surface only) + SDK consume() integration (transparent). → validates: integration test — 1 payment covers M polls within range; second payment on range exhaustion

## Wave 3 — the strategic builds

### G1 · x402-paid subgraph deploys  (L) — the S3 unlock
Accountless agent pays to deploy; forward-only (clamp already enforces); table expires unless renewed or claimed.
- [ ] T10 New surface `subgraph-deploy` in X402Surface + catalog (price: founder decision, suggest $2 flat; finality: CONFIRMED tier — writes get no optimistic window). Mount on POST /api/subgraphs for unauthenticated callers only (authed path unchanged).
- [ ] T11 Paid-deploy identity: subgraph owned by a synthetic wallet-account keyed on payer principal (reuse ghost-account machinery: ghost=true, no email, `wallet_principal` column) so cache/scoping/visibility all keep working. Migration: `wallet_principal` nullable unique on accounts + `expires_at` on subgraphs.
- [ ] T12 TTL: paid deploys get `expires_at = now()+7d`; renewal = paid `subgraph-renew` surface ($0.50/wk, same wire); claim (ghost claim flow extended to wallet-ghosts via signed message proving principal) clears expiry. Sweeper job mirrors ghost-sweep (drop schema + row on expiry).
- [ ] T13 SDK/CLI: `sl subgraphs deploy --pay` (uses withX402); deploy response carries expires_at + renewal price. MCP tool param `pay: true`.
- [ ] T14 The demo: scripted "agent pays 21 sats, ships an indexer, queries its own table" — marketing asset + docs page. → validates end-to-end on testnet rail first, then prod smoke with founder wallet

### G2 · prepaid x402 credit  (L)
- [ ] T15 `x402_balances` table (principal pk, balance_usd_micros, updated_at) + `deposit` surface (pay any amount ≥ $0.25 → credited at spot, confirmed-tier only). Ledger rows gain `kind: payment|deposit|drawdown`.
- [ ] T16 Drawdown path in middleware: `PAYMENT-BALANCE: <principal+sig>` header (signed challenge, no on-chain tx) debits balance instead of 402 round-trip; falls back to 402 when balance < price. Kills per-call signing latency.
- [ ] T17 Balance endpoint `GET /v1/x402/balance` (signed query). SDK: `withX402(..., { mode: "balance" })`.
- [ ] T18 Unlocks subscriptions-for-wallets: subscriptions gain `payer_principal` owner alongside account_id (routes ownership branch per grounding); delivery metered from balance daily. Founder decision: subscription pricing for wallet owners.

### G9 · wallet→account continuity (the funnel)  (M)
- [ ] T19 Link on claim: when a ghost/wallet account claims (email attach), associate historical `x402_payments` by payer principal (one-time backfill query + `account_id` column on ledger rows, nullable). Spend history visible in console usage.
- [ ] T20 Upgrade nudge: usage page + 402 challenge `extra` field carry "spent $X this month via x402 — Pro removes the meter" when monthly drawdown > threshold. → validates: ledger aggregation test + console render

## Wave 4 — surface expansion

### G7 · holder/balance snapshots  (M)
AIBTC tool parity (holder lists, token inventories). Cheapest correct path: first-party curated subgraphs (balances tables per major token, seeded under the exempt account w/ genesis) exposed via Explore — NOT a new index surface. Decision: which tokens (sBTC + top SIP-010s).
- [ ] T21 Seed `sbtc-balances` (+2-3 token balance subgraphs) w/ holder-rank table; add to Explore FEATURED; document as the holders endpoint in docs + llms.txt.

### G8 · batch query endpoint  (M)
- [ ] T22 `POST /v1/batch`: array of ≤10 read descriptors (surface+params), executed concurrently, single envelope; x402 price = sum of members (one payment). → validates: route test + MCP tool `batch_query`

## BD track (parallel, founder-led, not code)
- AIBTC integration: PR/partnership making Secondlayer a configurable data backend in aibtc-mcp-server (their Hiro dependency + rate-limit pain is explicit in their README). Best timed after Wave 1 (discovery live) so their x402 discovery tool finds us. Artifact: integration branch + a joint demo (their agent paying our rail).

## Sequencing & gates
1. Wave 1 ships immediately (no founder decisions needed) — G4 then G5.
2. G6 needs one decision (free quota size); G3 needs price/range decision.
3. G1 before G2 (one-shot paid deploy doesn't require credit; credit amplifies it). G9 after G2's ledger changes land (shares the `kind` column work) or independently against current ledger.
4. Rail must be ON in prod (X402_SPONSOR_KEY funded) before Wave 1 has anything to discover — currently dormant. Founder gate: fund sponsor wallet + flip.

## Decisions
1. Rail stays DORMANT in prod intentionally (founder); flip = sponsor wallet funding, founder-owned.
2. Price points LOCKED (delegated 2026-06-10): G6 free quota = 1,000 req/day/IP on Index then 402 (rail on) / 429 (rail off); G3 streams session = $0.001 per 100-block range per filter, voucher TTL 1h; G1 deploy = $2.00 flat (confirmed tier), 7-day TTL, $0.50/week renewal, claim clears TTL; G2 minimum deposit = $0.25, balances swept after 12 months of inactivity; wallet-owned subscriptions = metered from balance at $0.10/day per active subscription.
3. G7 token list: sbtc-balances, usdcx-balances, alex-balances (3 curated balance subgraphs to start).
4. BD timing: after Wave 1 ships (so AIBTC discovery tooling finds a live advertisement).

## Status
- Wave 1 SHIPPED 2026-06-10: G4 (/v1/x402/supported alias + enriched payload w/ floor + headers, /.well-known/x402, OpenAPI x-x402 block + path entry, web /llms.txt, MCP capabilities payPerCall block) + G5 (X402_PRIVATE_KEY → withX402-wrapped fetchImpl in MCP w/ stderr receipt logging, authState.x402WalletSet). T6 receipt-in-tool-response deferred (logging suffices for v1). Note: discovery returns enabled:false until the rail flips — intentional. Wave 1 prod-verified (supported/well-known/llms.txt all live).
- G3 SHIPPED 2026-06-11 (committed, push owned by founder w/ datasets-teardown timing): session vouchers — settle on streams mints HMAC `PAYMENT-SESSION` (id = challenge nonce, SECONDLAYER_SECRETS_KEY-signed, 1h TTL) good for 500 calls via rate-limit-store budget; middleware verifies statelessly before free quota; withX402 caches voucher per origin, drops on 402, re-arms on next settle. Implementation note: per-100-block ranges simplified to call-budget sessions (equivalent economics for tip-followers ~$0.024/day, vastly simpler; anon rate limits still bound bulk extraction).
- WAVE 4 SHIPPED 2026-06-10: **G8** POST /v1/batch (≤10 public /v1 reads, self-dispatch closure through full app pipeline so per-item auth/quota/x402 semantics hold; forwards Authorization/PAYMENT-BALANCE/PAYMENT-SESSION + real client IP; allowlist /v1/{index,subgraphs,streams,contracts,x402/supported}) + sdk sl.batch() + mcp batch_query + llms/OpenAPI entries. **G7** templates `scripts/seed-balances/{sbtc,usdcx,alex}-balances.ts` (ft_transfer/mint/burn → patchOrInsert balance arithmetic, startBlock 1, validated against validateSubgraphDefinition; ALEX id age000-governance-token::alex — seed script probes Index for live transfers per contract and aborts if absent) + `scripts/seed-balances.sh` (FOUNDER-RUN: needs genesis-exempt SL_API_KEY) + Explore FEATURED pre-wired (missing names filter until seeded). Holders-endpoint docs intentionally held until seeded (no documenting 404s).
- G9 SHIPPED 2026-06-11 (committed, push founder-owned): migration 0096 (x402_payments.account_id FK SET NULL + partial idx; x402_balances spent_month/spent_month_usd_micros); recordSpend month-bucketed on per-call settles + drawdowns (deposits excluded — top-ups aren't consumption); upgradeHint at $25/mo threshold surfaced on deposit/balance/wallet responses; POST /api/wallet/link (PLATFORM_PATHS-authed): Stacks signed message bound to accountId (replay-safe), pubkey→c32address(22, hash160) must match principal, adopts wallet-ghost (subgraphs move + expires_at cleared "claiming makes permanent", shell deleted), links ledger history; GET /api/wallet = balance + monthly spend + hint. Full merge path e2e-tested w/ real keypair + stubbed verify.
- G2 CORE SHIPPED 2026-06-11 (committed, push founder-owned): migration 0095 (x402_balances usd-micros per principal w/ CHECK>=0; x402_payments.kind payment|deposit); balance module (atomic credit/debit-with-floor, 30d HMAC PAYMENT-BALANCE token reusing session machinery); middleware balanceDrawdown (checked before session/quota; X-BALANCE-REMAINING-USD response header) + priceUsdOverride for variable-amount deposits + ledgerKind; POST /v1/x402/deposit?usd=N (min $0.25 / cap $100, confirmed-tier, returns balance_token) + GET /v1/x402/balance (token-authed); drawdown enabled on index+streams mounts; supported payload advertises prepaid block; SDK withX402 {balanceToken, topUp:{usd,whenBelow}} — watches remaining header, background self-deposit through its own paying wrapper, adopts fresh token. T18 (wallet-owned subscriptions) deferred; inactivity sweep deferred.
- G1 CORE SHIPPED 2026-06-11 (committed, push founder-owned): migration 0094 (accounts.wallet_principal partial-unique + subgraphs.expires_at); catalog surfaces subgraph-deploy $2 / subgraph-renew $0.50 (confirmed-tier, 120s); middleware exposes x402Payer to handlers; wallet-ghost find-or-create (targetless ON CONFLICT — partial index can't be a conflict target); POST /v1/subgraphs (paid deploy, managed-only, BYO 400) + POST /v1/subgraphs/:name/renew via registerPaidWriteRoutes (injectable for tests, 503 PAYMENT_RAIL_UNAVAILABLE when rail off); deploy handler extracted as runSubgraphDeploy(c, identity?) threading accountId + 7d paidTtl → expires_at in response; daily subgraph-expiry-sweep worker cron via shared deleteSubgraph. T13 (SDK/CLI --pay) + T14 (demo) deferred to follow-up; wallet-ghost claim flow = open seam.
- G6 SHIPPED 2026-06-11: freeQuota option on x402 middleware (challenge step consults per-IP store before 402; injectable quotaStore for tests); index mount passes 1,000/day/IP; streams unchanged; rail-off behavior untouched (quota only consulted when middleware is mounted, i.e. rail on).
