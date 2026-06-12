# x402 STX Spot Feed Fix — Session Kickoff

> ✅ STATUS 2026-06-12: code EXECUTED INLINE (not a separate session). Sprints 1–3 + the env-
> correction design are DONE: red test reproduced the retry storm → green; `spot.ts` rewritten
> (`nextAttemptAt` cadence/backoff split, 429 `Retry-After`, debounced warns, 5m success
> cadence, `primeSpot()` warm boot wired in `index.ts`); plus the unrelated 4 DB-dependent x402
> middleware test failures fixed via an injectable `recordSpend`. `/check` green; changeset
> `.changeset/x402-spot-feed-retry-storm.md` created. REMAINING (founder-gated): **T7** correct
> prod `X402_SPOT_STX_USD` + add `X402_SPOT_SBTC_USD` server-side, **T8** `/release` + push
> (Deploy), **T9** prod-verify then un-pause the smoke ladder. Sprint detail below kept for
> reference.

> Paste into a fresh session: "Read docs/sprints/x402-spot-feed-fix-kickoff.md and fix the
> x402 spot-feed bug. Reproduce it with a test first, then implement, /check, changeset,
> /release, and redeploy. This blocks the x402 smoke ladder (Phase 3 of
> x402-activation-kickoff.md) — fix it before testing resumes."

## Context (read first, trust this over memory)

The x402 rail is **LIVE in prod** (flipped 2026-06-12 — sponsor `SP1BZXJW…`, treasury
`SP143YHR…`). Activation Phase 3 (smoke ladder) is **paused on this bug**.

**Symptom**: every `/v1/x402/*` 402 prices STX off the static env fallback
(`X402_SPOT_STX_USD`), never the live CoinGecko feed. Live STX ≈ $0.179; prod is pinned to
the env value `0.218876` (a typo for `0.178876`) → ~22% overcharge on STX. sBTC is dropped
from every offer (no env fallback set, live feed dead). USDCx is unaffected (dollar peg, no
oracle).

**Confirmed root cause** (verified on the prod api container, not a guess):
- CoinGecko's free endpoint (`api.coingecko.com/api/v3/simple/price`) rate-limits hard:
  measured **first ~5 rapid calls = 200, then sustained 429**.
- `packages/api/src/x402/spot.ts` `refresh()` only sets `cache.fetchedAt` on a **successful**
  fetch. On any failure (429, non-ok, throw) `fetchedAt` stays at its old value (0 on cold
  start). `spotUsd()` fires `void refresh()` whenever `Date.now() - cache.fetchedAt > FRESH_MS`.
- So one failed refresh → `fetchedAt` never advances → **every subsequent request re-fires a
  refresh** → continuous CoinGecko calls → permanent 429 storm → cache never populates → STX
  forever on env fallback, sBTC forever null.
- The `catch {}` in `refresh()` is **silent** — no log line, so the outage is invisible.
- Egress is NOT the problem: `curl` and one-shot `bun -e fetch` to CoinGecko from inside the
  container both return 200 with live data. It's purely the self-inflicted retry storm + rate
  limit.

**Key files**:
- `packages/api/src/x402/spot.ts` — the cache + `refresh()` + `spotUsd()`. THE fix site.
- `packages/api/src/x402/middleware.ts:136` `buildAccepts()` — calls `opts.spot?.(symbol)`
  (defaults to `spotUsd`); `usdPerToken === null` drops the asset from `accepts[]`. No change
  needed, but this is why sBTC vanishes.
- `packages/api/src/x402/__tests__/spot.test.ts` — existing coverage (USDCx peg, cold-cache
  null, env override, live-feed-once-refreshed, buildAccepts degrade). Extend here.
- Test helpers already exported from spot.ts: `_resetX402SpotForTests`,
  `_refreshX402SpotForTests`.

**Current spot.ts constants**: `FRESH_MS=60_000`, `MAX_STALE_MS=600_000`,
`FETCH_TIMEOUT_MS=3_000`. Cache shape `{ btcUsd, stxUsd, fetchedAt }`, module-level
`refreshing` guard.

## Sprint 1: Reproduce the bug (red test)
- [ ] **T1**: In `spot.test.ts`, add a test that mocks `fetch` to fail (e.g. return
      `new Response("", {status:429})`), calls `_refreshX402SpotForTests()`, then asserts a
      SECOND refresh attempt is NOT fired on the very next `spotUsd()` call (i.e. failures are
      throttled). With today's code this FAILS (every call re-fires). → validates: test is red
      against current spot.ts, green after Sprint 2. Use a fetch spy with a call counter.

## Sprint 2: Stop the retry storm + see it (core fix)
- [ ] **T2**: Split refresh cadence from data staleness. Add `lastAttemptAt` (gates whether
      `refresh()` fires) distinct from `fetchedAt` (gates data freshness). `refresh()` sets
      `lastAttemptAt = Date.now()` in a `finally` (always — success OR failure). `spotUsd()`
      fires refresh only when `Date.now() - lastAttemptAt > RETRY_MS`. → validates: T1 goes
      green; a failing feed now hits CoinGecko at most once per `RETRY_MS`, not once per request.
- [ ] **T3**: Make failures visible. Replace the silent `catch {}` and the bare `if (!res.ok)
      return` with a **debounced** `logger.warn` (e.g. once per minute, keyed) including status.
      Don't log-spam per request. → validates: unit test asserts a warn fires on non-ok; manual
      grep of prod api logs after deploy shows the feed state.
- [ ] **T4**: Raise `FRESH_MS` (refresh cadence) to **300_000 (5 min)** and set `RETRY_MS` to a
      shorter backoff (e.g. 30_000) so a recovering feed re-tries sooner than the success
      cadence. STX/BTC don't move enough in 5 min to matter for $0.001 pricing, and 1 call /
      5 min / replica is nowhere near CoinGecko's limit. → validates: reasoning documented in a
      code comment; existing live-feed test still green.

## Sprint 3: Warm boot + reliability hardening
- [ ] **T5**: Prime the cache once at api startup — an awaited `refresh()` (or fire-and-forget
      with a short retry) during boot so the FIRST requests serve live, not fallback. Find the
      api bootstrap (search `packages/api/src` for the Hono app/server entry) and call it there,
      guarded by `isX402Enabled()`. → validates: after deploy, the first 402 on a fresh replica
      already carries the live STX amount (~5500µ at $0.179), not 4569µ.
- [ ] **T6** (decide, then do): CoinGecko free tier is the real constraint. Either (a) honor
      `429 Retry-After` with backoff (cheapest), and/or (b) support a `X402_SPOT_API_KEY` /
      authenticated CoinGecko URL via the existing `X402_SPOT_URL` override + a header. Recommend
      (a) now, leave (b) as a documented env hook. → validates: burst test from the container no
      longer wedges the cache (sustained 200s within the new cadence).

## Sprint 4: Prod env correction + ship
- [ ] **T7**: Correct the prod fallbacks in `/opt/secondlayer/docker/.env` (FOUNDER pastes
      server-side): fix `X402_SPOT_STX_USD` to the live value (~`0.178…`), and ADD
      `X402_SPOT_SBTC_USD=<live BTC/USD>` so sBTC is priceable when the feed is down. These are
      fallbacks only once the live feed works. → validates: `printenv` in a recreated api replica.
- [ ] **T8**: `/check` → changeset (api is private; bump per repo convention) → `/release` →
      push to main (triggers Deploy). REMINDER: env-only changes need container RECREATE, not
      restart — a code deploy via `deploy.sh` recreates anyway. → validates: CI green, deploy
      records success.
- [ ] **T9** (post-deploy prod verify): `GET /v1/x402/supported` → `enabled:true`. Live 402 on
      `/v1/streams/stx-transfers?limit=1` → STX `amount` now reflects **live** price (≈ $0.179 →
      ~5500µSTX, NOT 4569µ), sBTC present in `accepts[]`. Probe the SAME replica repeatedly — the
      quote tracks the live feed and survives past `FRESH_MS`. Grep api logs: no 429 storm. → THEN
      un-pause x402-activation-kickoff.md Phase 3 (smoke ladder).

## Hard rules
- Reproduce with a red test BEFORE fixing (global CLAUDE.md bug-report rule).
- Work off `main`; single conventional-line commits; changeset for the api change.
- Don't log-spam: any new feed-failure log MUST be debounced.
- The rail stays live throughout — this is a pricing-accuracy fix, not a flip. Kill switch
  (blank `X402_SPONSOR_KEY` + recreate) is unchanged and still available.

## Open questions for the founder
- T6: honor-Retry-After only, or also wire an authenticated CoinGecko key now? (Recommend
  Retry-After now, key as a documented env hook.)
- T4 cadence: is a 5-min STX price granularity acceptable for $0.001-scale pricing? (Recommend
  yes — sub-cent surfaces don't need tighter.)
