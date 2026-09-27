# Incidents

Chronological log of customer-facing or potentially-customer-facing issues. Newest first.

Entry shape:

- **Date** (ISO)
- **Title**
- **Severity** — P1 (customer-impacting), P2 (degraded), P3 (latent / caught internally)
- **Detection** — how we found it
- **Root cause** — one sentence
- **Fix** — PR number(s) / commit(s)
- **Prevention** — what we added to keep it from recurring

---

## 2026-09-27

### Transactions missing from 64 blocks after three deep reorgs

- **Severity:** P1 (customer-impacting: Index, Streams and signed archive snapshots omitted 677 transactions and 32,106 events)
- **Detection:** A PoX-5 cycle replay against the node disagreed with indexed stake events. Tracing it showed blocks storing fewer transactions than the node reported, at 8,777,879, 8,831,514–8,831,580 and 8,964,785–8,964,808 (64 blocks), after deep reorgs on Aug 16, Aug 24 and Sep 11. Block rows and block range digests were correct, so every existing check passed.
- **Root cause:** `transactions` holds one row per `tx_id`. A tx re-mined into a lower height on the winning fork hit the insert conflict and was skipped, then deleted with the losing fork's height.
- **Fix:** Commits in the persist/reorg/integrity series (fail-loud tx-set assertion, `blocks.tx_count`, `reconcileReorgedRange` 200-height lookback, `findShortBlocks`) plus `repair-from-journal.ts`. Prod: 64/64 blocks restored from `observer_journal`, each matching the node's tx merkle root; sBTC, PoX-5, BNS and registry rows rederived. Archive republished; Streams dumps `0008770000`, `0008830000`, `0008960000` re-exported. Published report: `published/2026-09-27-short-blocks-at-deep-reorgs.json` (superseded + corrected snapshot digests, consumer action).
- **Prevention:** `/health/integrity` reports `shortBlocks`; node replay auditor attests tx membership via merkle root; single-leaf merkle root fixed in `@secondlayer/shared` 11.14.3 (one-tx blocks false-mismatched before). Open: export gate refusing short blocks, CLI `repair` for child-partition divergence.

## 2026-08-12

### transactions.function_args double-encoded for every row since migration 0021

- **Severity:** P3 (latent — no customer impact; every in-repo reader tolerated both shapes)
- **Detection:** Found while writing a CSV-encoder stress test for the archive restore path. A test asserting `function_args` round-tripped as an array failed; checking production showed `jsonb_typeof(function_args) = 'string'` for **all 14,439,077 non-null rows**.
- **Root cause:** `parser.ts` passed `JSON.stringify(functionArgs)` into a `jsonb` column. postgres.js serializes whatever it is given, so a pre-serialized value is encoded a second time — storing a JSON *string containing JSON* rather than an array. `events.data` did it correctly (raw object), which is why only this column was affected. A second writer in `repair-transactions.ts` made the same mistake and would have re-poisoned repaired rows.
- **Fix:** Commits f6f403ed (both writers, plus corrected `string | null` typing), 272d2a12 (fixtures reseeded in the real array shape). Backfill tool `backfill-function-args.ts` converted all 14.4M rows via `(function_args #>> '{}')::jsonb`, idempotent and batched so concurrent live ingest could not be corrupted.
- **Prevention:** Regression tests pin the parser output shape and the backfill's idempotence, including a Clarity arg whose *content* is itself JSON (the case a naive unwrap would strip a level too many). Misleading comments in `runner.ts` and `contract-calls.ts` that blamed postgres.js driver behaviour were corrected — that folklore is how the bug survived.
- **Note:** The backfill's tail ran a full table scan per batch as matches grew sparse (`LIMIT` cannot short-circuit when only 19k of 28M rows match). A keyset walk would keep every batch equally cheap; recorded for the importer work.

## 2026-08-11

### Five canonical fork points left on losing reorg branches

- **Severity:** P3 (latent — invisible for four months; downstream reads served the wrong block at five heights)
- **Detection:** The new canonical coverage audit reported `broken_link_count: 5` — canonical children naming parents the database no longer held. Nothing had ever run this check before.
- **Root cause:** Pre-2026-07-30 reorg logic adopted any same-height hash mismatch on sight, so transient Nakamoto miner races caused the indexer to adopt losing contenders. When the chain kept building on the original branch, nothing could flip the fork point back: the original block's payload was overwritten and the node never re-sends it. Affected heights 7662338, 7884701, 8501111, 8524836, 8567288 (2026-04-19 → 2026-07-16).
- **Fix:** Repaired each height with `repair-fork-block.ts --apply`, verified against the canonical chain (Hiro-canonical hash matched what each child named), then rebuilt decoded rows — one height had been serving 1,282 phantom decoded rows from the orphaned block. Residual code gap closed in ba79fb5e: a settled fork now stages the deposed incumbent as a contender, so a settle-then-abandon sequence can flip back instead of being unrecoverable.
- **Prevention:** `secondlayer-canonical-audit.timer` runs the bounded audit nightly with Slack alerting and preserves every report. The ingest parent-hash mismatch check was promoted from a warning to an error with a repair pointer and a telemetry counter — it had silently logged all five corruptions as they happened. `repair-fork-block.ts` now takes a per-height advisory lock after two concurrent repairs collided on a foreign-key error.

---

## 2026-05-03

### blocks.timestamp = 0 in production after live node connection

- **Severity:** P3 (latent — status page surfaced it, no customer impact)
- **Detection:** Status page tip lag tile showed nonsense timestamp after wiring to live Stacks node.
- **Root cause:** Indexer parser only read `timestamp` field from `/new_block` payloads. Live node sends `burn_block_time`. Replay payloads use `timestamp`. Both are valid; parser handled only one.
- **Fix:** PR #23 (commit 513642f) — `blockTimestamp(payload)` reads `timestamp`, `block_time`, `burn_block_time`, `burn_block_timestamp` in priority order with finite-positive validation. Type contract loosened to mark all four fields optional on `NewBlockPayload`.
- **Prevention:** Regression test covers all four aliases plus genesis-zero. Tech debt tracked: "staging health monitoring should alert on `blocks.timestamp = 0` for any block in last hour."

### /v1/streams/events default query times out (502)

- **Severity:** P2 (broken endpoint; no customer impact since paying integrations always pass `from_height`)
- **Detection:** Smoke check post-PR-23 revealed `GET /v1/streams/events?limit=10` hung ~9s and returned 502 from Caddy with empty body.
- **Root cause:** Default `/events` query had no lower bound on height and `types` filter was applied in JS post-fetch. Unfiltered calls scanned `decoded_events` from genesis, exceeded Caddy's upstream timeout. Latent since PR #18.
- **Fix:** Commit ccec87f — handler computes `effective_from_height = tip - STREAMS_BLOCKS_PER_DAY` when neither `from_height` nor `from_cursor` is provided. Explicit `from_height=0` or `from_cursor=0:0` still backfills from genesis. `types` filter pushed into SQL. Default behavior documented in OpenAPI route schema and PRD 0001.
- **Prevention:** Regression test asserts default `/events` returns within 1s. Tech debt tracked: "post-deploy smoke check in CI should fail the workflow if `/events` returns non-200 or `reorgs` is null."

### Deploy timeout during cold Docker build

- **Severity:** P3 (deploy infrastructure; no customer impact — prod stayed on prior commit)
- **Detection:** Hotfix PR for /events landed on main but prod smoke check still showed the old behavior. GitHub Actions Deploy run 25290982926 conclusion: failure. Last log line: "Run Command Timeout".
- **Root cause:** `appleboy/ssh-action` had `command_timeout: 5m`. Cold Docker build of 5 images (api, indexer, migrate, worker, agent) didn't finish in time. SSH session killed mid-build. Prod stayed on previous commit.
- **Fix:** Bumped `command_timeout` to 20m in `.github/workflows/deploy.yml` with inline comment referencing this incident.
- **Prevention:** Tech debt tracked: detach Docker build from SSH session (nohup/systemd/tmux) so deploy completion isn't bounded by SSH timeout; layer-cache Docker builds so cold-build cost amortizes; CI step to run prod smoke check after deploy.

---
