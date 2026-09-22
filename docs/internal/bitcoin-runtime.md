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
| Phase | **0: measure + demand** (not started) |
| Executor plan | `plans/036-bitcoin-phase-0.md` |
| Spike host | `stacks-feeder` (Hetzner Cloud `cpx62`, FSN, 4T volume), shared with Stacks genesis IBD |
| Bitcoin source | node-server bitcoind `37.27.171.220:8332` (full, txindex), feeder IP already allowlisted |
| Prod impact | none. No prod box changes in Phase 0 |
| Last updated | 2026-09-22 (D8, D12, D14 locked) |

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
| `ord` 0.29.0 Runes index size | | | |
| `ord` Runes sync wall time | | | |
| RPC fetch, verbosity 0 (blocks/s, MB/s) | | | |
| RPC fetch, verbosity 2 (blocks/s, MB/s) | | | |
| Rune count / rune-bearing UTXO count at tip | | | |
| Feeder Stacks IBD rate during `ord` sync | | | |

## Demand ledger

Named builders only. Source link required. Outreach is founder-led.

| Who | Use | Source | Would pay / self-host | Status |
|---|---|---|---|---|
| | | | | |
