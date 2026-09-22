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
| Phase | **0: measure + demand — Phase 0 in progress: ord syncing** |
| Executor plan | `plans/036-bitcoin-phase-0.md` |
| Spike host | `stacks-feeder` (Hetzner Cloud `cpx62`, FSN, 4T volume), shared with Stacks genesis IBD |
| Bitcoin source | node-server bitcoind `37.27.171.220:8332` (full, txindex), feeder IP already allowlisted |
| Prod impact | none. No prod box changes in Phase 0 |
| Last updated | 2026-09-22 (D8, D12, D14, D16 locked) |

## Phases and gates

| Phase | Goal | Host | Exit gate |
|---|---|---|---|
| **0** Measure + demand | `ord --index-runes` synced; RPC fetch benchmark; Runes dataset sizes; named demand list | feeder | **Gate 0** |
| **1** Runes decoder spike | TS decoder backfills 840,000 → tip; digest parity with `ord` at every checkpoint | feeder | **Gate 1** |
| **2** Runes product | Bitcoin Streams, `/v1/index/runes/*`, webhook triggers, SDK, oss compose profile, docs; soak at tip | feeder (staging) | **Gate 2** |
| **3** Prod migration | Bitcoin runtime on local NVMe; feeder no longer serves Bitcoin | prod host (D8) | **Gate 3** |
| **4** Inscriptions (metadata) | Same shape as 1–3: spike, parity, product | prod host | Gate 4 |
| Later | Protocol decoders (BRC-20, sats names, Alkanes, marketplace sales, rare sats, collections) | prod host | named customer each |

### Gate criteria

| Gate | Pass means | Result |
|---|---|---|
| 0 | `ord` Runes index at tip with size + time recorded; RPC benchmark recorded; demand threshold (D14) met; D4, D6 decided | pending |
| 1 | Zero rune-entry and balance digest divergence vs `ord` at every checkpoint 840,000 → tip; backfill wall time + PG size recorded; decoder fails closed on divergence | pending |
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
| D5 | 2026-09-22 | `ord` is the parity reference, never the serving path. Our decoder serves; `ord` checks | PROPOSED (Gate 0) |
| D4 | 2026-09-22 | Decoder in TS/Bun (one stack), not a runehook (Rust) fork | PROPOSED (Gate 0) |
| D6 | 2026-09-22 | Fetch raw blocks (`getblock` verbosity 0) and parse in TS; verbosity 2/3 JSON only if the benchmark says parsing is the bottleneck | PROPOSED (Gate 0, benchmark) |
| D9 | 2026-09-22 | Bitcoin Streams is a thin reorg-aware reader over bitcoind. Do not mirror raw Bitcoin blocks/txs into Postgres | PROPOSED (Gate 1) |
| D10 | 2026-09-22 | Reorg handling: per-block undo journal ≥12 blocks deep; deeper reorg halts ingest and pages (fail closed) | PROPOSED (Gate 1) |
| D11 | 2026-09-22 | Inscription content is not served; metadata only until a takedown process exists | PROPOSED (Phase 4) |
| D8 | 2026-09-22 | Prod topology mirrors today's split: node-server stays the node layer (bitcoind, stacks-node); Bitcoin app layer (ord, decoders, Bitcoin PG, API) goes on a **new dedicated box with extra local NVMe**, app-server-shaped, reading node-server bitcoind over the DC network. Not co-located on node-server | LOCKED |
| D12 | 2026-09-22 | Tip following via ZMQ (`hashblock` + `rawblock`) on node-server bitcoind, no polling. Needs a prod bitcoind config change + restart (brief burn-feed gap for prod stacks-node; schedule a window). ZMQ is unauthenticated: publish only on the private allowlist, same DOCKER-USER pattern as `:8332`, never `0.0.0.0/0`. Lands as its own step in the Phase 1 plan | LOCKED |
| D13 | 2026-09-22 | Pricing for hosted Bitcoin Index reads (credit meter vs separate) | OPEN (Gate 2) |
| D14 | 2026-09-22 | Gate 0 demand threshold: ≥3 named builders with a concrete Runes use, ≥1 willing to pay or self-host in production | LOCKED |
| D15 | 2026-09-22 | Brand: Bitcoin as data on the existing plane (default per PRODUCT.md principle 5) vs an endorsed library at `bitcoin.secondlayer.tools` for the account-free SDK half | OPEN (Gate 2) |
| D16 | 2026-09-22 | Rotate the bitcoind RPC credential in the D12 ZMQ restart window (one prod bitcoind restart for both), and move bitcoind RPC + ZMQ traffic off the public network (Hetzner vSwitch, WireGuard, or TLS) before Phase 3. Trigger: credential appeared in argv/`systemctl status` during the first execute run; RPC basic auth already crosses the public network in cleartext from app-server and the feeder | LOCKED |

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

**Prod (Phase 3): new dedicated Bitcoin app box with local NVMe, per D8.** Migration is a **rebuild, not a
copy**:

1. Provision the D8 host. Install the oss compose Bitcoin profile exactly as
   a self-hoster would (this is the self-host proof, per the build-for-
   everyone rule).
2. Rebuild `ord` and our Runes tables from bitcoind on local NVMe. Record the
   wall time; it is the number we quote self-hosters.
3. Run both hosts in parallel until digests match at the same height.
4. Switch routing (Caddy on app-server: Bitcoin `/v1` paths → prod host).
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
| Step 5 contention check (single reading, ~21:09Z) | feeder load 1.47/1.01/0.60 (transient spike, taken right after the verbosity-2/concurrency-8 bench burst); node-server load 2.00/1.57/1.30 (15-min avg 1.30 ≈ baseline ~1.1–1.3, so not sustained); prod burn 968185 = bitcoind tip 968185 (no lag); disk 1% used | 2026-09-22 | feeder `/proc/loadavg`+`df`, node-server `uptime`+`/v2/info`, bitcoind `getblockcount` |
| D6 recommendation (benchmark evidence, decision left PROPOSED for founder) | Verbosity 0 wins at every concurrency: ~2.7–3.1x more blocks/s than verbosity 2 (9.62 vs 3.59 @c1; 29.12 vs 9.63 @c4; 36.85 vs 11.79 @c8), despite verbosity 2 moving more MB/s (bigger JSON, more bitcoind-side serialization cost). TS parse cost on verbosity 0 is negligible (avg ~1–1.5ms/block, p95 ~2.7–3.2ms) vs fetch latency (p50 104–208ms) — parsing is nowhere near the bottleneck. Recommend confirming D6 as written (raw fetch verbosity 0 + TS parse) at Gate 0 | 2026-09-22 | derived from the RPC fetch rows above |

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
