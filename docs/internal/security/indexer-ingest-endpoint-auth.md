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

## 5. Proper fix (not done)

Add an application-layer shared secret to the ingest endpoints:

- Indexer requires a secret (e.g. `INDEXER_INGEST_SECRET`) on `POST /new_block` et al.; reject with `401` otherwise. Keep the firewall as defense-in-depth (belt-and-suspenders).
- **Obstacle to verify**: the Stacks node's `[[events_observer]]` config is believed to support only an endpoint URL + `events_keys` — **no custom auth header / bearer token field**. *This needs confirmation against the running node version before committing to a design.* If true, options are:
  1. Put the ingest endpoints behind the existing Caddy reverse proxy (443, already public + TLS) on a secret path, and point the node's observer at that path. Auth-by-unguessable-path is weak but better than nothing and node-compatible.
  2. Front the node→indexer hop with a small authenticating shim, or a private network (Hetzner vSwitch) so the trust boundary is a real private link rather than a public-IP allowlist.
  3. Upstream: request an auth-header field in the Stacks node event-observer config.

## 6. Recommended next steps

1. Verify the Stacks node event-observer auth-header capability (decides which §5 option is viable).
2. Assign a finding ID and slot into the security backlog (P1).
3. Add a monitoring probe that alerts if 3700 becomes reachable from a non-node public IP (catches §4 lapses actively rather than by luck) — pairs with the `health-alert.sh` pattern already in `docker/scripts/`.
