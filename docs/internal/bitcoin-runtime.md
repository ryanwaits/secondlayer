# Bitcoin runtime: roadmap, decisions, gates

Orientation anchor for extending Secondlayer to Bitcoin (Runes first,
inscriptions second). Strategy lives in STRATEGY.md ("Bitcoin"). This file
is the running record: where we are, what is decided, what gates the next
phase, and where every box lives. Executor plans live in `plans/` (local);
this file outlives them.

**Rules for this file**

- Update **Current position** and the relevant **Gate** row at every phase
  boundary. A phase does not start until the previous gate row is filled.
- The **Decision log** is append-only. Reversing a decision adds a new row
  that supersedes the old one; never edit history.
- The **Measurements** ledger holds observed numbers only. Estimates stay in
  the brief, not here.

Brief: https://claude.ai/artifact/DsN9iEsNpFuVhX3jr27Zoq

## Current position

| Field | Value |
|---|---|
| Phase | **1: Runes decoder spike** (in progress: block integrity + digest chain shipped, baseline==optimized proven byte-identical at 841,000, backfill advancing 841,000→900,000; C1/C2/C3 state parity blocked on `ord` reaching tip, still syncing from genesis) |
| Executor plan | `plans/037-bitcoin-runes-decoder-spike.md` (steps 0–7 backfill portion done; steps 7 ord-compare, 8–10 pending `ord` sync); `plans/039-runes-backfill-integrity-and-profile.md` (steps 1–6 done, step 7 running, step 8 partial — this row) |
| Spike host | `stacks-feeder` (Hetzner Cloud `cpx62`, FSN, 4T volume), shared with Stacks genesis IBD |
| Bitcoin source | node-server bitcoind `37.27.171.220:8332` (full, txindex), feeder IP already allowlisted |
| Prod impact | none. No prod box changes in Phase 0/1 |
| Last updated | 2026-09-23 (plan 039: merkle/witness integrity + digest chain shipped; baseline vs optimized digests + state-hash byte-identical at 841,000; backfill running toward 900,000, clean through 844,000) |

## Phases and gates

| Phase | Goal | Host | Exit gate |
|---|---|---|---|
| **0** Measure + demand | `ord --index-runes` synced; RPC fetch benchmark; Runes dataset sizes; named demand list | feeder | **Gate 0** |
| **1** Runes decoder spike | TS decoder backfills 840,000 → tip; digest parity with `ord` at every checkpoint | feeder | **Gate 1** |
| **2** Runes product | Bitcoin Streams, `/v1/index/runes/*`, webhook triggers, SDK, oss compose profile, docs; soak at tip | feeder (staging) | **Gate 2** |
| **3** Prod migration | Bitcoin runtime on local NVMe; feeder no longer serves Bitcoin | app-server + added NVMe (D8) | **Gate 3** |
| **4** Inscriptions (metadata) | Same shape as 1–3: spike, parity, product | prod host | Gate 4 |
| Later | Protocol decoders (BRC-20, sats names, Alkanes, marketplace sales, rare sats, collections) | prod host | named customer each |

### Gate criteria

| Gate | Pass means | Result |
|---|---|---|
| 0 | `ord` Runes index at tip with size + time recorded; RPC benchmark recorded; demand threshold (D14) met; D4, D6 decided | **partial (2026-09-22):** demand MET (founder confirms users, go); benchmark recorded; D4/D5/D6 LOCKED; contention clear. Remaining: `ord` at tip + size/time + rune counts |
| 1 | Decode diff 0 mismatches on the sample; entry + balance diff 0 at C1, C2, C3 (D17); supply invariant holds at every flush 840,000 → C3; backfill wall time + PG size recorded; fail-closed tests pass (invariant break, prev-hash break) | **partial (2026-09-23):** decode diff 0 mismatches (~101,282 txs sampled: block 840,000 full, 840,001–840,021 full, block 850,000 full, one-per-10k 850,000–960,000 — 840,022–840,099 not separately covered; the reviewer judged the C1 state compare below covers that range end-to-end once run); backfill 840,000→841,000 done (2,030s, invariant held at every flush, no continuity breaks); PG size + row counts recorded; `parity-state` implemented and verified against a real ord sample (seedGenesis() UNCOMMON•GOODS 0 mismatches vs live ord data). Remaining: run `parity-state` at C1=841,000 once `ord` (height ~250k of 968k) reaches it |
| 2 | ≥14 days at tip, continuous parity green, one reorg handled (live or injected on regtest), oss compose profile boots from empty and reaches tip | pending |
| 3 | Prod host at tip with parity green; digests match feeder at the same height; routing switched; Bitcoin containers removed from feeder | pending |

## Decision log

Status: **LOCKED** (founder-confirmed), **PROPOSED** (recommended, confirm at
the named gate), **OPEN** (needs founder call).

| # | Date | Decision | Status |
|---|---|---|---|
| D1 | 2026-09-22 | Hosted decoded reads stay. Generic decoding always hosted; protocol decoders earn their place. Supersedes the 2026-08-16 "retire /v1 + decoders" direction | LOCKED |
| D2 | 2026-09-22 | Runes and inscriptions are Index tier (one standard, one reference impl). Protocol decoders on top are noted and deferred | LOCKED |
| D3 | 2026-09-22 | Runes before inscriptions | LOCKED |
| D7 | 2026-09-22 | Phase 0–2 run on `stacks-feeder`, reading node-server bitcoind remotely. No prod box changes | LOCKED |
| D5 | 2026-09-22 | `ord` is the parity reference, never the serving path. Our decoder serves; `ord` checks | LOCKED (2026-09-22, founder) |
| D4 | 2026-09-22 | Decoder in TS/Bun (one stack), not a runehook (Rust) fork | LOCKED (2026-09-22, founder) |
| D6 | 2026-09-22 | Fetch raw blocks (`getblock` verbosity 0) and parse in TS; verbosity 2/3 JSON only if the benchmark says parsing is the bottleneck | LOCKED (2026-09-22, founder; bench: verbosity 0 ~3x blocks/s of verbosity 2, parse ~1ms/block) |
| D9 | 2026-09-22 | Bitcoin Streams is a thin reorg-aware reader over bitcoind. Do not mirror raw Bitcoin blocks/txs into Postgres | PROPOSED (Gate 1) |
| D10 | 2026-09-22 | Reorg handling: per-block undo journal ≥12 blocks deep; deeper reorg halts ingest and pages (fail closed) | PARTIAL (spike halts on prev-hash mismatch; undo journal in Phase 2) |
| D11 | 2026-09-22 | Inscription content is not served; metadata only until a takedown process exists | PROPOSED (Phase 4) |
| D8 | 2026-09-22 | Prod topology mirrors today's split: node-server stays the node layer (bitcoind, stacks-node); Bitcoin app layer (ord, decoders, Bitcoin PG, API) goes on a **new dedicated box with extra local NVMe**, app-server-shaped, reading node-server bitcoind over the DC network. Not co-located on node-server. **Amended 2026-09-25 (founder, cost):** no new box. The Bitcoin app layer runs on **app-server with an added NVMe drive** dedicated to it (own mount, own Postgres container). node-server stays the node layer, unchanged. Why: a new dedicated box at post-June-2026 Hetzner pricing was ~$220–290/mo of a ~$650–720 steady state; a drive add-on keeps the grandfathered AX52 price and fixes app-server's real limit (disk 85% used). Runs no customer code, so no isolation cost. Revisit (own box) only if Bitcoin load contends with the Stacks API on app-server CPU/RAM | LOCKED |
| D12 | 2026-09-22 | Tip following via ZMQ (`hashblock` + `rawblock`) on node-server bitcoind, no polling. Needs a prod bitcoind config change + restart (brief burn-feed gap for prod stacks-node; schedule a window). ZMQ is unauthenticated: publish only on the private allowlist, same DOCKER-USER pattern as `:8332`, never `0.0.0.0/0`. Lands as its own step in the Phase 1 plan | LOCKED |
| D13 | 2026-09-22 | Pricing for hosted Bitcoin Index reads (credit meter vs separate) | OPEN (Gate 2) |
| D14 | 2026-09-22 | Gate 0 demand threshold: ≥3 named builders with a concrete Runes use, ≥1 willing to pay or self-host in production | LOCKED |
| D15 | 2026-09-22 | Brand: Bitcoin as data on the existing plane (default per PRODUCT.md principle 5) vs an endorsed library at `bitcoin.secondlayer.tools` for the account-free SDK half | OPEN (Gate 2) |
| D16 | 2026-09-22 | Rotate the bitcoind RPC credential in the D12 ZMQ restart window (one prod bitcoind restart for both), and move bitcoind RPC + ZMQ traffic off the public network (Hetzner vSwitch, WireGuard, or TLS) before Phase 3. Trigger: credential appeared in argv/`systemctl status` during the first execute run; RPC basic auth already crosses the public network in cleartext from app-server and the feeder | LOCKED |
| D17 | 2026-09-22 | Parity method: ord has no historical state, so parity runs at frozen heights. ord is held at H with --height-limit H+1, then `ord runes` + `ord balances` are diffed against our state at H. Checkpoints C1=841,000, C2=900,000, C3=ord tip. Plus a decode diff (our runestone decipher vs ord /decode/{txid}) and our own supply invariant at every flush | LOCKED |
| D18 | 2026-09-22 | Spike package packages/bitcoin is self-contained (npm deps only, no @secondlayer/* imports) so it installs standalone on any box; integrating with shared/indexer is a Phase 2 decision | LOCKED |
| D19 | 2026-09-23 | Runes integrity in three layers. (1) Input: every block's txid merkle root and BIP-141 witness commitment are verified against the header/coinbase before apply; mismatch halts. (2) Derivation: a per-block digest chain d_H = sha256(d_{H-1} ‖ blockhash ‖ sha256(canonical sorted events)) stored in rune_block_digests, the equality guard for any decoder change, plus ord parity at frozen heights (D17). (3) Distribution: signed state roots, a verify --runes CLI, and balance proofs are Phase 2. Runes state has no on-chain commitment; the claim is byte-exact input + independent-implementation agreement + a re-derivable signed chain | LOCKED |

## Hosting and migration strategy

**Spike (Phases 0–2): `stacks-feeder`.** Already paid, already allowlisted on
node-server `:8332`, 4T volume nearly empty. Constraints: network volume
(~5k IOPS / 200 MB/s cap), shared vCPU, 30GB RAM shared with the Stacks
genesis IBD. Every Bitcoin process on it runs niced and memory-capped so the
Stacks IBD rate does not drop. The Stacks IBD always wins a conflict.

Layout on the feeder:

```
/data/feeder/stacks      Stacks IBD (plan 030), untouched
/data/feeder/postgres    Stacks scratch PG (plan 030), untouched
/data/feeder/ord         ord index (Phase 0+)
/data/feeder/btc-pg      Bitcoin runtime Postgres (Phase 1+), separate instance
```

A separate Postgres instance, not a schema in the Stacks scratch PG: plan 031
pair-restores the Stacks PG onto prod, and Bitcoin rows must not ride along.

**Prod (Phase 3): app-server with an added NVMe drive for Bitcoin, per D8 (amended 2026-09-25).** Migration is a **rebuild, not a
copy**:

1. Add the NVMe drive to app-server (Hetzner Robot add-on, maintenance
   window), mount it for Bitcoin data only. Install the oss compose Bitcoin
   profile exactly as a self-hoster would, as its own compose project (this is the self-host proof, per the build-for-
   everyone rule).
2. Rebuild `ord` and our Runes tables from bitcoind on local NVMe. Record the
   wall time; it is the number we quote self-hosters.
3. Run feeder and app-server in parallel until digests match at the same height.
4. Switch routing (Caddy on app-server: Bitcoin `/v1` paths → the local
   Bitcoin API container).
5. Stop and delete Bitcoin containers and `/data/feeder/{ord,btc-pg}` on the
   feeder. The feeder then retires on its own schedule (plan 031).

Why rebuild: a copy from a network volume hides the local-NVMe timing, and a
rebuild exercises the same path customers run. Fallback if the rebuild is
slower than ~2 days: `pg_basebackup` from the feeder, then verify digests.

**Feeder retirement ordering.** Plan 031 deletes the feeder after the Stacks
pair-restore soaks. If 031 lands before Gate 3, either resize a small cloud
VM for the Bitcoin staging stack or bring Phase 3 forward. Do not delete the
feeder while it holds the only Bitcoin index.

## Measurements

Observed values only. Fill as Phase 0 runs.

| Metric | Value | Date | Source |
|---|---|---|---|
| Bitcoin tip at plan time | 968,177 | 2026-09-22 | node-server `getblockcount` |
| Runes range to backfill | 840,000 → tip (~128k blocks) | 2026-09-22 | derived |
| Feeder Stacks IBD baseline | tip 10,039, load 0.24 | 2026-09-22 | feeder `/v2/info` |
| node-server free disk | ~1TB (`/` 470G, `/home` 555G) | 2026-09-22 | `df` |
| app-server free disk | 131G (85% used) | 2026-09-22 | `df` |
| Step 1 baseline reading 1 (pre-ord) | feeder tip 10125, load 0.30/0.28/0.25; node-server load 1.29/1.19/1.11; prod burn 968180 / stacks tip 9044724 | 2026-09-22T20:39:36Z | feeder `/v2/info`+`/proc/loadavg`, node-server `uptime`+`/v2/info` |
| Step 1 baseline reading 2 (pre-ord) | feeder tip 10151, load 0.31/0.23/0.23; node-server load 1.00/1.13/1.11; prod burn 968181 / stacks tip 9044767 | 2026-09-22T20:51:11Z | feeder `/v2/info`+`/proc/loadavg`, node-server `uptime`+`/v2/info`. **Caveat: only ~12 min after reading 1, not the ≥1h gap the plan step asks for; rate below is a noisy short-window sample, not the IBD baseline rate** |
| Feeder Stacks IBD baseline rate (short-window, noisy) | 26 blocks / ~11.6 min ≈ 134 blocks/h | 2026-09-22 | derived from readings 1–2 above |
| `ord-runes` start height | began fetching from block 0 (genesis), not 840,000 — first index commit (commit-interval=5000) landed at height 4999 within ~5 min of service start | 2026-09-22 | `curl localhost:8089/status` on feeder, `journalctl -u ord-runes` |
| `ord` 0.29.0 Runes index size | in progress, not yet at tip (this run only measures early sync; Phase 0 continuation records final size) | 2026-09-22 | `du -sh /data/feeder/ord` |
| `ord` Runes sync wall time | in progress, not yet at tip | 2026-09-22 | `progress.log` |
| RPC fetch, verbosity 0 (blocks/s, MB/s) | c1: 9.62 blk/s, 12.11 MB/s, p50 104.6ms, p95 120.8ms, parse avg 1.50ms/p95 3.18ms · c4: 29.12 blk/s, 36.67 MB/s, p50 134.3ms, p95 188.6ms, parse avg 1.06ms/p95 2.83ms · c8: 36.85 blk/s, 46.40 MB/s, p50 208.3ms, p95 367.8ms, parse avg 0.92ms/p95 2.71ms | 2026-09-22 | `bench/bitcoin-rpc-fetch.ts` on feeder, `FROM=900000 COUNT=500`, TS parse (tx+output count) included |
| RPC fetch, verbosity 2 (blocks/s, MB/s) | c1: 3.59 blk/s, 27.52 MB/s, p50 297.4ms, p95 376.6ms · c4: 9.63 blk/s, 73.90 MB/s, p50 454.7ms, p95 583.1ms · c8: 11.79 blk/s, 90.49 MB/s, p50 573.7ms, p95 1373.5ms | 2026-09-22 | `bench/bitcoin-rpc-fetch.ts` on feeder, `FROM=900000 COUNT=500` |
| Rune count / rune-bearing UTXO count at tip | not yet measured — ord not at tip this run | | |
| Feeder Stacks IBD baseline rate (pre-`ord`, short-window) | 26 blocks / ~11.6 min ≈ 134 blocks/h (noisy, <1h window — see caveat above) | 2026-09-22 | derived, readings 1–2 |
| Feeder Stacks IBD rate during `ord` sync (step 5 check) | 37 blocks / ~17.4 min ≈ 128 blocks/h (tip 10151→10188, 20:51:11Z→21:08:35Z) ≈ 95% of the pre-`ord` short-window rate — well above the 80% floor | 2026-09-22 | derived, feeder `/v2/info` + `progress.log` |
| Contention check 2 | feeder Stacks tip 10188→10267 over 34.5 min ≈ 137 blocks/h (≥ baseline); feeder load 0.25; prod burn 968192 = bitcoind tip 968192; node-server load 1.30 (15-min); disk 1% | 2026-09-22T21:43Z | feeder `/v2/info`, node-server `uptime`/`getblockcount` |
| `ord` early sync rate | 0→34,999 in ~46 min (near-empty early blocks; not predictive of tip ETA) | 2026-09-22T21:39Z | `progress.log` |
| Step 5 contention check (single reading, ~21:09Z) | feeder load 1.47/1.01/0.60 (transient spike, taken right after the verbosity-2/concurrency-8 bench burst); node-server load 2.00/1.57/1.30 (15-min avg 1.30 ≈ baseline ~1.1–1.3, so not sustained); prod burn 968185 = bitcoind tip 968185 (no lag); disk 1% used | 2026-09-22 | feeder `/proc/loadavg`+`df`, node-server `uptime`+`/v2/info`, bitcoind `getblockcount` |
| D6 recommendation (benchmark evidence, decision left PROPOSED for founder) | Verbosity 0 wins at every concurrency: ~2.7–3.1x more blocks/s than verbosity 2 (9.62 vs 3.59 @c1; 29.12 vs 9.63 @c4; 36.85 vs 11.79 @c8), despite verbosity 2 moving more MB/s (bigger JSON, more bitcoind-side serialization cost). TS parse cost on verbosity 0 is negligible (avg ~1–1.5ms/block, p95 ~2.7–3.2ms) vs fetch latency (p50 104–208ms) — parsing is nowhere near the bottleneck. Recommend confirming D6 as written (raw fetch verbosity 0 + TS parse) at Gate 0 | 2026-09-22 | derived from the RPC fetch rows above |
| Decode diff sample (plan 037 step 6) | 0 mismatches across ~101,282 txs: block 840,000 full (2,004 txs), blocks 840,001–840,021 full (~95,423 txs, run interrupted mid-window given session time budget — 840,022–840,099 not yet covered), block 850,000 full (849 txs), one-block-per-10,000 850,000→960,000 (3,006 txs across 11 blocks) | 2026-09-23 | `@secondlayer/bitcoin` `parity-decode` vs ord `/decode/{txid}`, reports in `/data/feeder/btc-parity/decode-2026-09-22-*.json` |
| Backfill 840,000→841,000 (plan 037 step 7, backfill-only; ord-compare deferred — ord not synced) | Wall time 2,030.3s (33.8 min) for 1,001 blocks; 6 flushes (every 200 blocks); supply invariant held at every flush (no throw); no continuity breaks; final row counts: rune_entries 20,805, rune_balances 1,692,674, rune_events 6,213,583, btc_blocks 1,001; PG database size 1,487 MB (`pg_database_size`), `/data/feeder/btc-pg` disk 2.5G. Per-flush detail: 840,199 (367,181 balance upserts/0 deletes, 4,237 entries, 1,329,979 events, 52.3s), 840,399 (380,312/40,325, 4,290 entries, 1,203,307 events, 50.9s), 840,599 (465,649/28,244, 1,263 entries, 1,863,815 events, 71.9s), 840,799 (314,520/69,772, 3,081 entries, 933,466 events, 41.7s), 840,999 (382,065/79,255, 9,968 entries, 881,579 events, 42.6s), 841,000 (646/103, 610 entries, 1,437 events, 0.36s) | 2026-09-23 | `@secondlayer/bitcoin` `backfill --to 841000` on `stacks-feeder`, `docker logs runes-backfill`, `pg_database_size`, `du -sh` |
| Flush batching defect + fix (plan 037 step 7) | First backfill attempt: unbatched per-outpoint DELETE+INSERT stalled 45+ min with 0 rows committed (single-row statements in `pg_stat_activity`). Fixed via `computeBalanceChanges` (skip net-zero in-window churn) + chunked multi-row upserts/deletes. Second attempt crashed on `MAX_PARAMETERS_EXCEEDED` (rune_entries has 21 columns; 5,000-row chunk sent 105,000 params > Postgres's 65,534 limit) — fixed by lowering `ENTRY_CHUNK_SIZE` to 1,000. Both fixes have regression tests (`src/db/store.test.ts`) | 2026-09-23 | reviewer-caught during live run; `pg_stat_activity`, `docker logs` error output |
| Contention during backfill (plan 037 step 7) | Feeder Stacks tip 10555→10924 over ~2h39m ≈ 139 blocks/h (≥ 134 baseline, no degradation); feeder load stayed 0.2–1.4 (normal range) through the whole backfill; node-server load 1.1–1.4 (normal); `/data/feeder` disk 1% used throughout; ord's own sync unaffected (independent process) | 2026-09-23 | feeder `/v2/info`+`/proc/loadavg`, node-server `uptime` |
| Etch event tx_index data bug + fix (plan 037 step 7, reviewer round 2) | `createRuneEntry` pushed etch events with a hardcoded `txIndex: 0` instead of the real etching tx index (`id.tx`); fixed in code and repaired the 20,804 already-flushed `rune_events` rows on btc-pg via `UPDATE rune_events SET tx_index = split_part(rune_id,':',2)::int WHERE kind='etch'` (verified 0 mismatches after). Added a test asserting an etch at tx index 3 records `txIndex: 3` | 2026-09-23 | reviewer-caught; `pg_stat_activity`/direct `psql` verification on btc-pg |
| `parity-state` verified against a real ord sample (plan 037 step 7, reviewer round 2) | Captured live via `ord ... runes`/`ord ... balances` at ord height 246,489 (well below the Runes launch; used because a one-off CLI run with `--height-limit 841001` would force `update()` to index ~594k more blocks before printing — hours, not "verify now" — so height-limit was set to ord's then-current height+1 instead, a deviation from the literal reviewer instruction, noted here). Our `seedGenesis()` UNCOMMON•GOODS entry diffs 0 mismatches against the real sample (confirms `spacers: 128`, `turbo: true`, `cap: u128::MAX`, `height: [840000, 1050000]` all correct); balances sample is genuinely empty pre-840,000, diffs 0 against our empty state. Samples committed as test fixtures (`test/fixtures/sample-ord-{runes,balances}-246489.json`); `ord-runes` service stopped/restarted cleanly around the capture (confirmed active after) | 2026-09-23 | `@secondlayer/bitcoin` `src/parity/state.test.ts` on `stacks-feeder`, `ord ... runes`/`balances` CLI |
| Baseline backfill 840,000→841,000, integrity-checked (plan 039 step 3) | Wall time 2,106.4s (35.1 min), FLUSH_INTERVAL=200, 6 flushes; 0 merkle/witness errors across 1,001 blocks; invariant held every flush; row counts identical to the 037 run (entries 20,805 / balances 1,692,674 / events 6,213,583); `runes_c1` preserved via `pg_dump`+restore before reset, same counts. digests TSV (1,001 lines) + state-hash exported | 2026-09-23 | `digests-baseline-840000-841000.tsv`, `state-hash-baseline-841000.txt` in `/data/feeder/btc-parity/` |
| CPU profile, heaviest 200 blocks (plan 039 step 4) | 426.6s window (840,000–840,199). Phase split: commitRpcMs 78.1% (8,480 sequential RPC round trips), flushMs 13.4%, integrityMs 3.6%, applyMs 2.4%, decipherMs 2.0%, fetchWaitMs 0.4% (sums to 99.8%). Top self-time: `fetch` 8.3%, `subarray` 6.1%, `json` 4.2%, sha256 `process` 3.4%, `takeOutpointBalances` 2.9% | 2026-09-23 | `/data/feeder/btc-parity/profile-baseline.md`, raw `.cpuprofile`/`.md` alongside it |
| Optimizations applied (plan 039 step 5) | (1) Parse raw block fields as buffer views instead of copies (removes ~6 `Uint8Array.from` copies/field/tx) — targets the `subarray`/`get buffer` profile cost. (2) Resolve etching-commitment RPCs (`tx_commits_to_rune`'s RPC half) in the parallel fetch worker instead of the sequential apply loop, cached by prevTxid+blockhash, bounded to 8 concurrent requests process-wide (an unbounded first attempt overwhelmed bitcoind's RPC work queue — HTTP 503, caught live). Map/bigint churn (candidate 3, ~10% of self time) confirmed present but not optimized this pass — the RPC win already dominates | 2026-09-23 | commits on `feat/bitcoin-phase-0` |
| Baseline vs optimized equivalence (plan 039 step 6) | `cmp` on both the digest TSV and the state-hash file: exit 0 (byte-identical) at 841,000. Wall time 2,106.4s → 618.5s, a 3.4x speedup (840,000–840,199 window alone: 407.5s → 123.8s, 3.3x); `commitRpcMs`/`commitRpcCount` drop to 0 in every optimized flush line, confirming the RPC move landed | 2026-09-23 | `digests-optimized-840000-841000.tsv`, `state-hash-optimized-841000.txt` in `/data/feeder/btc-parity/`, `cmp` exit codes |
| Backfill 841,000→900,000, in progress (plan 039 step 7) | Clean through checkpoint 844,000 as of this update (2 flushes: 843,000 in 460.3s, 844,000 in 812.6s cumulative; 0 integrity errors; blocks/s 2.22–2.84; rssMB 7.8–8.5GB). Two live-caught defects fixed mid-run: (1) `runes` container `mem_limit` 6g→16g after a cgroup OOM-kill at FLUSH_INTERVAL=1000 in the still-dense post-launch window (host had 29GB free; not a host-wide OOM, Stacks IBD unaffected); (2) `rune_entries.symbol` mapped to `null` for a literal U+0000 codepoint (Postgres text columns reject a raw NUL byte; a Runestone Symbol tag legally allows codepoint 0) — crashed the flush with Postgres error 22021, fixed with a regression test, does not affect the 841,000 digest/state-hash proof (no such etching existed in 840k–841k). Final 900k stats (wall time, blocks/s by 10k segment, PG size, row counts, digest) pending — reviewer to record on completion | 2026-09-23 | `docker logs runes-backfill-900k` on `stacks-feeder` |
| State parity C2 = 900,000 (plan 051) | First compare (`btc` at 900,000 vs `ord` 0.29.0): balances 0 mismatches (outpoints 7,694,866 = 7,694,866); runes 178,853 vs ord 178,862, 9 etchings missing, all in blocks 861,933 (tx 196, 206, 207, 210, 572, 585, 4161, 4162) and 861,934 (tx 874); 70,524 entry mismatches, all field `number`, all ours = ord minus 9 (cascade from the missing etchings, rune `number` is an etching-order counter). Replay (`runes_c2`, `CREATE DATABASE ... TEMPLATE runes_c1` at 841,000 plus the seeded 841,000 digest row, then `backfill --to 900000`): wall time 21,402.0s (5h 56m), checkpoint reached 900,000, 0 integrity errors, no new OOM kills (steady at 3), disk stayed under 4%. Digest chain vs `btc` over 841,000 to 900,000 (59,001 rows each): first divergent digest at height 861,933, `event_count` differs only at 861,933 (5483 vs 5491, +8 events) and 861,934 (5189 vs 5190, +1 event), no other divergent heights. `parity-state` at 900,000 against the same ord dumps: runes 178,862 = 178,862, outpoints 7,694,866 = 7,694,866, entry mismatches 0, balance mismatches 0. OUTCOME: TRANSIENT, the 9-etching miss did not reproduce from known-good 841,000 state, current code is correct | 2026-09-25 | `@secondlayer/bitcoin` `backfill --to 900000` and `parity-state` on `stacks-feeder`; `/data/feeder/btc-parity/c2-replay/{digests-btc,digests-runes_c2}.tsv`, `900000-diff.json` |

## Demand ledger

Named builders only. Source link required. Outreach is founder-led.

Sweep notes: `hirosystems/runehook` and `hirosystems/ordinals-api` are
archived/deprecated (redirect to `hirosystems/bitcoin-indexer`), decommissioned
2026-03-09 per Hiro's own announcement — the "largest neutral provider shut
down" event STRATEGY.md's Bitcoin section references. `hirosystems/bitcoin-indexer`
has zero issues created after 2025-11-03 (confirmed via GitHub GraphQL,
`issues.totalCount`=221, all 221 fetched and none newer) — the GitHub-issue
migration-pain channel is quiet; no fresh named asks found there. Hiro's own
deprecation post names the gap directly: Xverse (their recommended alternative)
does not cover "block-level [Runes] activity and global etching lists," which
"require application-layer aggregation" — i.e. exactly what a self-hosted
Runes index would serve. Named builders below were found via the Stacks
Runes-on-L2 ecosystem (Bitflow/Pontis Runes AMM launch), not via GitHub issues.

| Who | Use | Source | Would pay / self-host | Status |
|---|---|---|---|---|
| Bitflow Finance | Runs the first Runes AMM on Stacks (Bitflow app); needs live Rune balance/activity data for BILLION•DOLLAR•CAT, DOG•GO•TO•THE•MOON, LIQUIDIUM•TOKEN pools | [PRNewswire, 2024-12-18](https://www.prnewswire.com/news-releases/bitflow-and-pontis-launch-first-bitcoin-runes-amm-on-bitcoin-l2-stacks-enhancing-bitcoin-asset-trading-302335805.html) | Not publicly stated — needs founder outreach | Named, unconfirmed |
| Pontis (bridge) | Federated bridge moving BTC/Runes/BRC-20 onto Stacks and back; needs Rune UTXO/balance verification for mint/burn | [same PRNewswire release](https://www.prnewswire.com/news-releases/bitflow-and-pontis-launch-first-bitcoin-runes-amm-on-bitcoin-l2-stacks-enhancing-bitcoin-asset-trading-302335805.html); [Pontis GitBook](https://pontis.gitbook.io/about) | Not publicly stated — needs founder outreach | Named, unconfirmed |
| Liquidium | Described as "the largest DeFi protocol on Runes"; Runes-collateralized lending needs Rune balance/price data; Pontis bridge signer | [OrdinalsBot/Sulu integration writeup](https://nftnow.com/guides/ordinalsbot-ultimate-guide-bitcoin-runes-brc20-trio/) | Not publicly stated — needs founder outreach | Named, unconfirmed |
| OrdinalsBot | Ordinals/Runes inscription service; Pontis bridge signer; needs Ordinals + Runes indexing for inscription/mint workflows | [nftnow OrdinalsBot guide](https://nftnow.com/guides/ordinalsbot-ultimate-guide-bitcoin-runes-brc20-trio/) | Not publicly stated — needs founder outreach | Named, unconfirmed |
| Asigna | "Smart custody layer for Bitcoin"; wraps Runes/Ordinals assets in bridge contracts (`asigna-ordinals-nft.clar`, `asigna-bridge-ft.clar` for psBTC+Runes); Pontis bridge signer | [stacksgov/critical-bounties#22](https://github.com/stacksgov/critical-bounties/issues/22) (2024, bounty spec); [PRNewswire release](https://www.prnewswire.com/news-releases/bitflow-and-pontis-launch-first-bitcoin-runes-amm-on-bitcoin-l2-stacks-enhancing-bitcoin-asset-trading-302335805.html) (signer role) | Not publicly stated — needs founder outreach | Named, unconfirmed |

D14 threshold (≥3 named builders with a concrete Runes use, ≥1 willing to
pay/self-host in prod): the **≥3 named-builders-with-concrete-use** half is
met (5 above). The **≥1 willing to pay or self-host** half is **not met** by
public sourcing alone — every "would pay/self-host" cell above is an
inference from public product surfaces, not a stated commitment; only
founder-led outreach (out of scope for this research pass) can confirm it.

**2026-09-22 founder call:** D14 met. "We have the users, it's a go." Pay/self-host commitments are held founder-side, not recorded here.
