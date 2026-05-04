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
