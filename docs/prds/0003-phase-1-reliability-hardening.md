# PRD 0003 - Phase 1 Reliability Hardening

**Status:** Implemented; production acceptance pending
**Owner:** Ryan
**Last updated:** May 4, 2026
**Related docs:** `VISION.md` -> Calm infrastructure, `ARCHITECTURE.md` -> Reliability posture, `PRODUCTS.md` -> Public status page, `ROADMAP.md` Phase 1, `docs/audits/phase-1-reliability-hardening-audit.html`, `docs/adr/0001-phase-1-reliability-closeout.md`

---

## Summary

Phase 1 Reliability Hardening is the operational closeout for Stacks Streams and Stacks Index. The product surfaces now exist; this PRD defines the remaining work required to prove they are live, observable, metered, documented, and recoverable on the current single live server before the Phase 1 gate.

This is not a new product. It is not a new data API. It is the reliability wrapper around the Phase 1 products.

Hot-spare failover remains strategically correct, but it is no longer a Phase 1 requirement. There is no funded second live node/server today. Phase 1 closes by proving that the current server can be operated, inspected, rolled back, backed up, and recovered without buying more infrastructure.

## Goals

1. Make public status cover the Phase 1 SLO surface: live node/service health, Streams ingest lag, L2 decode lag, API p50/p95, and error rate.
2. Emit durable usage records in `usage_daily` for authenticated Stacks Streams and Stacks Index product reads.
3. Update public pricing/docs to the locked Free / Build / Scale / Enterprise catalog.
4. Document the current production server inventory and operator recovery runbook.
5. Complete a non-destructive recovery drill with recorded evidence.
6. Keep deploy, staging health, and post-deploy smoke checks aligned with the gate.

## Non-goals

- Cursor format changes.
- New Streams or Index endpoint shapes beyond additive status fields.
- Webhooks, push delivery, or Subscriptions work.
- Raw-event delivery from Stacks Streams.
- Phase 2 Console, Datasets, or parquet bulk dumps.
- Repricing. The pricing source of truth is already locked in `PRODUCTS.md`.
- Provisioning a second live node/server.
- Hot-spare automation or production failover rehearsal in Phase 1.
- Automatic failover promotion.

## Audience

- Internal operator deciding whether Phase 1 is safe to close.
- Build / Scale customers evaluating whether the public surfaces are production-ready.
- Future agents maintaining deploy, status, recovery, and deferred failover runbooks.

## Resolved decisions

| Decision | Resolution |
|---|---|
| Product usage storage | Extend existing `usage_daily` with product usage units. Do not add a second daily usage table in Phase 1. |
| Hot-spare availability | No hot spare exists today. Hot-spare automation and rehearsals are deferred until there is budget for a second node/server. |
| Future failover mode | Future failover should alert and require operator confirmation. It should not auto-promote in v0. |
| Decoder health gate | Staging Health gates on decoder `status`, not FT/NFT `lagSeconds`. Sparse event activity remains visible but does not fail the gate by itself. |
| Backup/deploy coordination | Daily `pg_dump` and deploy migrations share a host DB maintenance lock. Deploy must not terminate an active backup session. |
| WAL archiving | WAL archiving is enabled in the Hetzner compose override and requires one controlled Postgres restart on deploy. |

## Current state from audit

Already in place:

- Stacks Streams `/v1/streams/events` and `/v1/streams/tip`.
- Stacks Index `/v1/index/ft-transfers` and `/v1/index/nft-transfers`.
- Paid auth and per-product rate-limit buckets.
- Public `/public/status` with Streams tip and FT/NFT decoder freshness.
- Scheduled/manual staging health workflow.
- Post-deploy smoke checks for health, auth variants, freshness shape, and response envelopes.
- SHA-tagged image deploys, host-side systemd deploy units, and image-only rollback.

Gaps:

- Production still needs the latest compose/scripts deployed so `/public/status.services[]` can report the indexer service through `INDEXER_URL=http://indexer:3700`.
- Daily `pg_dump` and WAL sync need fresh production evidence after the backup/deploy lock and WAL archiving changes land.
- Phase 1 remains open until two consecutive Staging Health runs pass after deploy and backup evidence is recorded.

Implemented:

- Public API p50/p95, error-rate metrics, node/service health, and reorg signal fields.
- Durable Streams and Index usage metering.
- Locked pricing/docs copy.
- Current live server inventory, operator recovery runbook, and non-destructive drill evidence.
- Atomic daily `pg_dump`, backup/deploy coordination lock, WAL archiving config, and robust WAL env loading.
- Staging Health decoder gating based on decoder `status` while printing `lagSeconds` for visibility.

## Scope

### 1. Public status completeness

Extend `/public/status` additively. Existing fields must remain stable.

Required public fields:

| Field | Meaning |
|---|---|
| `streams.tip.lag_seconds` | Existing Streams freshness signal. |
| `index.decoders[*].lagSeconds` | Existing FT/NFT L2 freshness signal. |
| `api.latency.p50_ms` | Rolling API p50 over the public status window. |
| `api.latency.p95_ms` | Rolling API p95 over the public status window. |
| `api.error_rate` | Rolling 5xx rate over the public status window. |
| `node.status` | Current live Stacks node health: `ok`, `degraded`, or `unavailable`. |
| `services[*].status` | Current live service health for API, indexer, decoder, database, and worker processes where available. |
| `reorgs.last_24h` | Count of recorded reorgs in the last 24h, or `null` if not available. |

Status page UI must show:

- API health.
- Current chain tip.
- Streams ingest lag.
- Stacks Index FT/NFT freshness.
- API p50/p95.
- Error rate.
- Current live node/service health.
- Incident note.

Public status must not expose private hostnames, IP addresses, secrets, database URLs, internal service URLs, or internal topology. The public shape should be semantic.

### 2. API latency and error-rate measurement

Add lightweight API telemetry that is safe to run in-process for Phase 1.

Minimum acceptable v0:

- Track rolling request duration samples per product group:
  - `streams`
  - `index`
  - `platform`
  - `status`
- Track rolling 5xx counts and total request counts for the same groups.
- Exclude obvious static/noise paths if needed.
- Expose aggregate p50/p95/error-rate through status routes.

Durability is not required for latency v0. If the API restarts, rolling metrics reset.

### 3. Product usage metering

Streams and Index metered units must match the product docs and extend `usage_daily`.

| Product | Metered unit | Trigger |
|---|---|---|
| Stacks Streams | events returned | Successful authenticated `/v1/streams/events` response. |
| Stacks Index | decoded events returned | Successful authenticated `/v1/index/*` response. |

Requirements:

- Meter only successful authenticated product reads with a resolved account or product tenant identity.
- Do not meter failed requests.
- Do not meter anonymous public status reads.
- Do not meter `/v1/streams/tip` as event usage.
- Preserve existing auth behavior and rate limits.
- Add tests proving Streams and Index emit the right unit counts.

Required `usage_daily` shape:

| Field | Requirement |
|---|---|
| account or tenant identity | Existing account/tenant reference used by billing aggregation. |
| usage date | UTC date bucket. |
| product | `stacks_streams` or `stacks_index`. |
| unit | `events_returned` or `decoded_events_returned`. |
| quantity | Number of events or decoded rows returned by the response. |

If `usage_daily` already has equivalent fields, reuse them. If it needs additive columns or enum values, keep the migration narrow and compatible with future Console display and nightly billing aggregation.

### 4. Pricing and docs alignment

Update public web pricing and relevant docs to the locked catalog.

Catalog:

| Tier | Price | Streams window | Index rows / mo | SLA |
|---|---:|---|---:|---|
| Free | $0 | 7 days | 100K | best effort |
| Build | $99/mo | 30 days | 2M | 99.5% |
| Scale | $499/mo | 90 days | 25M | 99.9% |
| Enterprise | custom | full archive | custom | custom |

Rules:

- Use product names from `PRODUCTS.md`: Stacks Streams, Stacks Index, Stacks Subgraphs, Subscriptions, MCP Server.
- Do not use ambiguous API labels, "Indexer" as a product name, or singular stream-product labels.
- Keep copy calm and technical.

### 5. Single-server recovery readiness

Document the operational shape of the current production server. This replaces Phase 1 hot-spare failover work.

Required artifacts:

- Current live server inventory:
  - public-safe host label
  - service list
  - deployment path
  - compose or systemd unit names
  - Stacks node RPC dependency label
  - event observer target label
  - backup mechanism and expected freshness check
- Operator runbook:
  - health inspection commands
  - service restart commands
  - deploy rollback commands
  - backup verification commands
  - log inspection commands
  - decision criteria for escalating beyond restart/rollback
- Post-recovery verification checklist:
  - `/health`
  - `/public/status`
  - `/v1/streams/tip`
  - one authenticated Stacks Streams read
  - one authenticated Stacks Index read

Recovery drill acceptance:

- One non-destructive recovery drill recorded in the sprint log or an ops note.
- The drill must not intentionally take production offline.
- The drill records:
  - date/time
  - operator
  - commands or checklist used
  - backup freshness result
  - smoke-check result
  - any manual intervention required

Target:

- Operator can inspect health, restart a service, verify backups, and run post-recovery checks from the runbook without discovering missing commands during an incident.

### 6. Deferred hot-spare milestone

Hot-spare infrastructure moves to a later funded reliability milestone.

Future acceptance should require:

- Funded second node/server.
- Documented primary and spare inventory.
- Operator-confirmed promotion command or runbook.
- Alert that recommends promotion when health signals justify it.
- Promotion only after operator confirmation.
- Rollback command or runbook.
- At least two rehearsals with recovery time and smoke-check evidence.

Automatic promotion is explicitly out of scope until there is enough redundancy and signal quality to make it safe.

## SLOs

Phase 1 public status should report:

- Streams ingest lag target: p95 <= 5s, p99 <= 15s.
- Stacks Index decode lag target: p95 < 5s.
- Build availability target: 99.5%.
- Scale availability target: 99.9%.

For v0, status may show current rolling measurements rather than monthly SLA accounting.

## Security

- Do not expose secrets, raw database URLs, private host IPs, private hostnames, API keys, or internal topology on public status.
- Public node/service status should be semantic.
- Runbooks and scripts must not print secrets to CI logs.
- Product metering must never include request payloads or Authorization headers.
- Recovery drill notes must redact any sensitive host, credential, or customer details.

## Acceptance criteria

1. `/public/status` is additive and includes API latency, API error rate, current live node/service health, Streams freshness, Index freshness, and incident note data.
2. `/status` remains available to authorized operators and includes enough detail to debug public degraded states.
3. Public status page renders all Phase 1 health categories without exposing private topology.
4. Streams and Index product usage units are recorded in `usage_daily` for successful authenticated product reads.
5. Product usage tests cover Streams events returned, Index decoded rows returned, no metering on failed requests, and no event metering for `/v1/streams/tip`.
6. Post-deploy smoke and staging health checks cover the expanded public status contract.
7. Pricing page uses Free / Build / Scale / Enterprise and the locked prices from `PRODUCTS.md`.
8. Current live server inventory exists with public-safe labels and no secrets.
9. Operator runbook covers health inspection, service restart, deploy rollback, backup verification, and log inspection.
10. Post-recovery checks cover `/health`, `/public/status`, `/v1/streams/tip`, one Stacks Streams read, and one Stacks Index read.
11. One non-destructive recovery drill is completed and logged.
12. Hot-spare failover automation and rehearsal are documented as deferred work, not Phase 1 gates.
13. No cursor, Streams event, or Index response envelope contract changes.

## Implementation order

1. Add API telemetry primitives and status route fields.
2. Update public status page and smoke tests.
3. Add product usage metering for Streams and Index through `usage_daily`.
4. Update pricing page and docs copy.
5. Write current live server inventory and operator recovery runbook.
6. Run one non-destructive recovery drill and record results.

## Validation plan

Docs-only validation for this rescope:

- Confirm this PRD has no unresolved open questions.
- Confirm acceptance criteria no longer require nonexistent spare infrastructure.
- Confirm `ROADMAP.md` and this PRD do not contradict each other.

Future implementation tests:

- API telemetry tests for p50/p95/error-rate aggregation.
- Usage metering tests for Stacks Streams events returned and Stacks Index decoded rows returned.
- Smoke checks for expanded `/public/status`.
- Recovery drill checklist with recorded output.

## Production acceptance evidence

Pending before this PRD can move to accepted:

- Deploy the compose/script changes to production.
- Confirm `/public/status` includes `api`, `node`, `services`, `streams`, `index`, and `reorgs`.
- Confirm `services` reports `api`, `database`, `indexer`, and `l2_decoder` as `ok`.
- Run two consecutive Staging Health checks after deploy.
- Run one manual `backup-postgres.sh` and verify the resulting gzip file.
- Force one WAL switch, run `sync-wal.sh`, and record a fresh sync log entry.
- Record latest local backup and latest remote upload timestamps.

## Risks

- **False confidence from shallow health checks.** Mitigation: status checks must include actual product reads, not just `/health`.
- **Single-server outage remains possible.** Mitigation: make restart, rollback, backups, and post-recovery checks explicit; defer redundancy until it is funded.
- **Pricing contradiction.** Mitigation: `PRODUCTS.md` remains canonical; web copy follows it.
- **Metrics overreach.** Mitigation: v0 uses rolling in-process telemetry; durable observability can expand after Phase 1.

---

*This PRD is the contract for Phase 1 reliability hardening. It authorizes analysis, docs, status, metering, recovery readiness, and deferred failover documentation only within the boundaries above.*
