# Finding — Unauthenticated indexer ingest endpoints (network-gated only)

- **Finding**: indexer event-ingest API has no application-layer authentication. Severity **P1** (chain-state integrity / write path), effort **M** for a real fix, rollout risk **MEDIUM** (touches the node↔indexer delivery contract). Discovered 2026-07-14 during an infra/reboot session.
- **Status of this doc**: live finding. A **network-layer mitigation is deployed** (commit `6d01061c`); the **app-layer fix is not done**. This is a defense-in-depth gap, not an open hole today.
- **Mitigation in place**: `docker/scripts/firewall-indexer.sh` + `docker/systemd/secondlayer-firewall.service`, installed by `deploy.sh`. Source-restricts published port 3700 to the Stacks node IP + the internal docker network via a `DOCKER-USER` iptables rule.

> **Live-risk banner**: with the firewall in place, the ingest API is reachable only from the Stacks node and the docker bridge. If that single control lapses (see §4 failure modes), *any* internet host can POST fabricated blocks, burn blocks, or mempool txs directly into the indexed chain state — there is no second line of defense at the application layer.

---

## 1. The mechanism

The indexer runs an HTTP server (`packages/indexer/src/index.ts`) that receives chain events from the Stacks node's event-observer. The write endpoints:

| Route | File:line | Effect on ingest |
|-------|-----------|------------------|
| `POST /new_block` | `index.ts:231` | Parses body → `ingestNewBlock(payload)` directly | 
| `POST /new_burn_block` | `index.ts:261` | `persistBurnBlockRewards(payload)` — PoX reward payouts / reward-set membership |
| `POST /new_mempool_tx` | `index.ts:286` | `ingestMempoolTxs(...)` |
| `POST /drop_mempool_tx` | `index.ts:307` | Hard-deletes mempool txs by txid |
| `POST /attachments/new` | `index.ts:326` | Attachment ingest |

**No authentication of any kind** is applied to these routes: no shared secret, no signature, no source-IP check in code. The only header read is `X-Source` (`index.ts:235`), used solely to decide whether to bump a metrics counter — not for auth. Each handler parses the JSON body and writes.

Two compounding infrastructure facts made this internet-reachable prior to 2026-07-14:

1. **Docker publishes 3700 on `0.0.0.0`** — `docker/docker-compose.yml:246` (`"${INDEXER_PORT:-3700}:3700"`, no host-IP bind).
2. **UFW does not protect it.** UFW *had* a rule restricting 3700 to the node IP, but Docker manages the iptables `FORWARD`/`DOCKER` chains directly for published ports, so container traffic never traverses UFW's `INPUT` chain. The UFW rule was a no-op — a false sense of security.

## 2. Exploitability

An attacker who can reach port 3700 can POST a well-formed `NewBlockPayload` and have it ingested as canonical chain data — fabricated transactions, events, balances, burn-block reward payouts, or targeted mempool deletions. Blast radius is the integrity of every downstream consumer of the index (decoders, subgraphs, streams, public API).

**Evidence (2026-07-14)**: from a non-whitelisted public IP (`136.62.99.163`, not the node's `37.27.171.220`):
- `GET  http://<app-server>:3700/health`    → `200`
- `POST http://<app-server>:3700/new_block` with `{}` → `500`

The `500` (not connection-refused, not `401/403`) proves the request reached the ingest code and failed only on the empty body. A valid payload would have been processed. **No fabricated payload was submitted** — the empty-body probe is sufficient proof of reachability without tampering with production data.

## 3. Current mitigation (deployed)

Commit `6d01061c`. Because compose cannot source-restrict a published port and UFW is bypassed, the control lives in `DOCKER-USER` — the one chain Docker guarantees it will not overwrite:

```
iptables -I DOCKER-USER 1 -p tcp --dport 3700 -j DROP
iptables -I DOCKER-USER 1 -p tcp --dport 3700 -s 172.18.0.0/16 -j RETURN   # internal docker net
iptables -I DOCKER-USER 1 -p tcp --dport 3700 -s <node-ip>     -j RETURN   # Stacks node
```

- `docker/scripts/firewall-indexer.sh` applies it idempotently and derives `<node-ip>` from `STACKS_NODE_RPC_URL` (single source of truth).
- `docker/systemd/secondlayer-firewall.service` re-applies it on boot (`After=docker.service`), because Docker recreates `DOCKER-USER` **empty** when the daemon starts.
- `deploy.sh` installs + enables the unit on every deploy, so `git reset --hard` (which every deploy runs) and freshly-provisioned servers self-heal.

Verified post-deploy: external IP blocked (timeout), node IP `200`, internal container health OK.

## 4. Residual risk — why this is not "fixed"

This is **network-layer only**. Single points of failure that silently reopen the write path:

| Failure mode | Result |
|--------------|--------|
| Node IP changes without updating `STACKS_NODE_RPC_URL` | Legitimate delivery breaks **and** the allow-rule points at the wrong host; if operator re-widens the rule to debug, hole reopens |
| `secondlayer-firewall.service` fails / is disabled | Rules gone after next docker-daemon restart or reboot |
| Docker daemon restarts between deploys | `DOCKER-USER` cleared until the systemd unit re-runs (boot) — a window if the daemon is restarted manually without reboot |
| New host / alternate deploy path that skips `deploy.sh` | No firewall, port wide open |
| Attacker already on the docker bridge or the node host | Fully trusted by the rule; can forge freely |

There is **no application-layer check** to catch any of these. The node is trusted purely by network position.

## 5. Delivery architecture (investigated 2026-07-14)

The node→indexer path is not direct — there's a reverse-proxy hop we control:

```
stacks-node (node-server, v3.4.0.0.3)
  │  [[events_observer]] endpoint = "event-proxy:3700"   (docker/node-server/Config.toml:9)
  ▼
nginx "event-proxy" sidecar (node-server, same host, internal docker net)
  │  proxy_pass http://65.21.135.94:3700   (docker/node-server/nginx/nginx.conf:12)   ← PUBLIC hop, plain HTTP
  ▼
indexer :3700 (app-server)  ← unauthenticated ingest
```

Two facts settle the fix design:

- **The node cannot send auth.** stacks-core's `[[events_observer]]` config supports only `endpoint`, `events_keys`, `timeout_ms`, `disable_retries` — no header/token/secret field, in any version. The outbound send path (`stacks-node/src/event_dispatcher/worker.rs`) adds only `Connection: close`. (The `auth_token` in `[connection_options]` is inbound-only — it guards requests *to* the node, wrong direction.) So "indexer requires a header, node sends it" is **not directly possible**.
- **But the nginx event-proxy is ours.** The node→nginx hop is same-host/trusted; the nginx→app-server hop is the untrusted public leg. nginx *can* `proxy_set_header`, so the secret is injected exactly on the leg that needs it, with zero node support required. This is the key that makes an app-layer secret viable.

Caveat: that public hop is currently plain HTTP, so a header secret crosses the internet in cleartext (replayable). Two design tiers below.

## 6. Proposed fix — staged plan (not implemented)

### Tier 1 — shared-secret header via nginx (minimal, keeps firewall)

**Indexer** (`packages/indexer/src/index.ts`): add a `withIngestAuth(handler)` HOF near the `PORT` read (~:49) and wrap the five write handlers — `/new_block` (:231), `/new_burn_block` (:261), `/new_mempool_tx` (:286), `/drop_mempool_tx` (:307), `/attachments/new` (:326). Leave `/health` (:136) and `/health/integrity` (:176) open (docker healthcheck, API status probe, and firewall/ops curls depend on them). Note: the `fetch` 404 fallback (:332) runs only for *unmatched* routes, so the guard must wrap the per-route POST handlers, not the fallback.

- Reads `INDEXER_INGEST_SECRET` + `INDEXER_INGEST_AUTH_MODE` (`off`|`warn`|`enforce`, default `off` when unset — soft-launch, today's behavior unchanged). Compare `X-Ingest-Secret` with `crypto.timingSafeEqual`. `warn` logs + proceeds; `enforce` returns `401`.
- Follows the indexer's direct-`process.env` convention; do **not** touch the `packages/shared/src/env.ts` zod schema (unused by these routes).

**nginx** (`docker/node-server/nginx/nginx.conf`, `location /`): `proxy_set_header X-Ingest-Secret "<secret>";` — env-templated, secret in node-server's `.env` (uncommitted). Primary live-delivery caller.

**Other internal HTTP callers that must also send the header** (verified — these self-POST, unlike tip-follower/auto-backfill which call `ingestNewBlock` in-process and need nothing):
- `packages/shared/src/node/archive-client.ts:148` (`replayGaps` → used by `bulk-backfill.ts:290` archive mode)
- `packages/cli/src/commands/db.ts:568` (CLI backfill)

**Compose** (`docker/docker-compose.yml` indexer env, ~:221): `INDEXER_INGEST_SECRET: ${INDEXER_INGEST_SECRET:-}` + `INDEXER_INGEST_AUTH_MODE: ${INDEXER_INGEST_AUTH_MODE:-off}`.

**Rollout (delivery must never break):**
1. Deploy indexer code, secret unset → auth no-op.
2. Set the secret on node-server nginx → forwarded events now carry the header; indexer still `off`, ignores it.
3. Set the same secret on the indexer with mode `warn` → watch logs for zero mismatches across several blocks + a burn block (proves the proxy header is correct).
4. Ensure archive/CLI callers read the secret from env, then flip to `enforce`.
5. Firewall stays as the outer layer.

The `warn` stage is the safety valve: it confirms the sender is correct *before* the receiver starts rejecting.

### Tier 2 — TLS + close the public port (stronger, more moving parts)

Point the nginx event-proxy at the existing Caddy (`443`, already public + TLS) on a secret path instead of raw `:3700`; Caddy routes internally to `indexer:3700`. Then the secret rides TLS (no cleartext), and the indexer port no longer needs public exposure at all — bind it to the internal interface and retire the `DOCKER-USER` allowlist. This folds the network fix and the app fix into one and removes the §4 residual-risk surface, at the cost of a Caddy route + node-server proxy reconfig.

## 7. Recommended next steps

1. Decide header vs `Authorization: Bearer`, and Tier 1 vs Tier 2 (recommend Tier 1 now, Tier 2 as follow-up).
2. Assign a finding ID; slot into the security backlog (P1).
3. Add a monitoring probe that alerts if `:3700` is reachable from a non-node public IP (actively catches §4 lapses) — pairs with the `health-alert.sh` pattern in `docker/scripts/`.

### Open questions
- Header name: `X-Ingest-Secret` vs `Authorization: Bearer`? (nginx handles either.)
- Guard `/attachments/new`, or leave open? (Harmless no-op today; guarding is free and uniform.)
- Secret delivery to node-server nginx: env-substitution template vs uncommitted conf file.
