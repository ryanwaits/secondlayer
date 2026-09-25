# Workload host (hosted webhooks + subgraphs, plan 044)

Internal. Not a public docs page. The permanent host for hosted chain
webhooks (044) and, once 046 lands, hosted subgraphs — one self-host stack
per tenant account, gatewayed and provisioned from this box.

Product map: [plan 044](../../../plans/044-workload-host.md) (gitignored —
see the plan index if this link 404s). Reversible: the app-server Caddy
route flips back to 404 and tenant stacks are independent compose projects,
so removing the host removes hosted webhooks without touching self-host.

## This deployment

Not yet provisioned as of this runbook's writing (2026-09-25) — step 1's
spend gate: `hcloud server create` for the permanent host runs only after
the founder says go. `docker/workload-host/provision.sh` is the re-runnable
script; `--dry-run` prints the exact commands without creating anything
billable.

| | |
|---|---|
| Host | `workload-host`, Hetzner Cloud, fsn1. Label `role=workload-host`. |
| SKU | `cpx32` (4 vCPU / 8 GB / 160 GB disk). **Not `cpx31`** — deprecated in fsn1 (`hcloud server-type describe cpx31`: `Available: no`, unavailable after 2025-12-31); `cpx32` is the same spec, currently available (verified live while writing this runbook). 046 may resize once subgraph handlers add load. |
| SSH | Cloud key `macbook-prod` (already registered — same key `stacks-feeder` uses). |
| Volume | `workload-data`, 100 GB ext4, automounted. Backs `/opt/secondlayer-workload` (tenant secrets, one dir per acct8) and each tenant's Postgres volume. |
| Cloud firewall | `workload-host`: TCP 22 from operator `136.62.99.163/32` (same IP `stacks-feeder`'s firewall already allowlists); TCP 443 from app-server `65.21.135.94/32` only. Nothing else inbound. |
| Runtime | `packages/workload` (`@secondlayer/workload`) — one Bun process, gateway + provisioner + meters. Not yet deployed to this host. |
| Tenant template | `docker/workload/tenant.compose.yml` — `postgres`, `migrate`, `api`, `webhook-service`. Images `image:`-pulled from GHCR (`ghcr.io/ryanwaits/secondlayer-{api,webhook-processor}`), never built on this host. |

## Egress model (Design)

Host-level `DOCKER-USER` iptables rules (`cloud-init.yaml`'s
`docker-user-egress.sh`, idempotent — safe to re-run after a reboot or
re-provision):

- Refused: RFC1918 (`10/8`, `172.16/12`, `192.168/16`), CGNAT (`100.64/10`),
  link-local (`169.254/16`), loopback (`127/8`), and the Hetzner metadata IP
  (`169.254.169.254`) explicitly. Since every tenant's compose network is a
  separate bridge inside one of these ranges, this is what stops tenant A
  reaching tenant B, and what stops any tenant reaching the host's own
  control-plane services.
- Allowed: app-server `65.21.135.94:443` (the gateway's own
  introspect/meters calls, and a tenant's `webhook-service` reading hosted
  Index/Streams), and the open public internet (a customer's own webhook
  receiver can be anywhere).
- The emitter's own app-level SSRF check (043,
  `packages/subgraphs/src/runtime/ssrf.ts`) stays as the first line — this
  host-level rule is the backstop, not a replacement.

## Bring-up

1. **Provision** (spend gate — founder go required):
   ```bash
   docker/workload-host/provision.sh --dry-run   # review the exact commands
   docker/workload-host/provision.sh             # creates the firewall, volume, server
   ```
2. SSH in, confirm Docker + `runsc` + the egress rules landed (cloud-init's
   `runcmd`):
   ```bash
   ssh -i ~/.ssh/id_ed25519_prod root@<workload-host-ip>
   docker info | grep -A2 Runtimes   # expect: runsc, runc
   iptables -L DOCKER-USER -n | head
   ```
3. Write the control-plane secrets (never committed, never logged):
   `WORKLOAD_HOST_KEY` (shared with app-server's `/internal/keys/introspect`
   and `/internal/meters` guards — generate with
   `openssl rand -hex 32` and set it on BOTH sides), `CONTROL_DATABASE_URL`
   (a small Postgres for the `tenants` table — can be a container on this
   same host; it is not a tenant database and never holds a tenant secret).
4. Deploy `packages/workload`:
   ```bash
   cd /opt/secondlayer-workload
   git clone <repo> . && bun install
   # .env: CONTROL_DATABASE_URL, APP_SERVER_URL=https://api.secondlayer.tools,
   #       WORKLOAD_HOST_KEY, TENANT_SECRETS_ROOT=/opt/secondlayer-workload/tenants,
   #       TENANT_COMPOSE_FILE=docker/workload/tenant.compose.yml, GATEWAY_PORT=8080
   bun run --filter @secondlayer/workload start
   ```
5. app-server Caddy: add the `/api/webhooks*` → this host's `:443` route
   (`docker/Caddyfile`) and set `WORKLOAD_HOST_KEY` there too.
6. Smoke test end to end (needs a real hosted account + `sk-sl_*` key):
   ```bash
   SECONDLAYER_API_KEY=sk-sl_... secondlayer webhooks create smoke-test \
     --trigger '{"type":"stx_transfer","minAmount":"1000000"}' \
     --url https://your-receiver.example.com/webhook
   ```
   First call 503s (provisioning); retry after `Retry-After` seconds lands
   on the newly-up tenant stack.

## Verify (step 1's egress check)

From inside a tenant container:

```bash
docker exec tenant-<acct8>-webhook-service-1 sh -c '
  curl -m3 -s -o /dev/null -w "metadata: %{http_code}\n"  http://169.254.169.254/ || echo "metadata: blocked"
  curl -m3 -s -o /dev/null -w "rfc1918: %{http_code}\n"   http://10.0.0.1/        || echo "rfc1918: blocked"
  curl -m3 -s -o /dev/null -w "internet: %{http_code}\n"  https://example.com/
  curl -m3 -s -o /dev/null -w "app-server: %{http_code}\n" https://api.secondlayer.tools/v1/index
'
```

Expected: metadata and RFC1918 fail (connection refused/timeout — the
`DROP` rules above), `example.com` and `api.secondlayer.tools` succeed. A
second tenant's `api` container (by its `tenant-<other-acct8>-api-1` DNS
name) must also fail — proven locally without the real host in
`packages/workload`'s step-3 verification (separate compose networks give
each tenant its own bridge with no cross-network DNS, confirmed via
`docker exec ... curl http://tenant-b-api-1:3800` from tenant A returning
"couldn't resolve host").

## Teardown

Reversible (plan's Reversible: YES) — flip the Caddy route back to 404,
then:

```bash
hcloud server delete workload-host
hcloud volume delete workload-data
hcloud firewall delete workload-host
```

Each tenant stack is destroyed independently by the provisioner
(`packages/workload/src/provisioner.ts`'s `destroy()`: `pg_dump` to R2,
`compose down -v`, secrets directory removed) — deleting the host does not
implicitly destroy tenant data; do that first if a real teardown (not just
a host resize/replace) is intended.

## Open

- Memory per idle tenant stack: measured locally (amd64 emulation on
  arm64, so likely somewhat high) at ~0.37–0.41 GB per tenant
  (postgres + api + webhook-service, `docker stats --no-stream`) — close to
  050's ~0.3 GB assumption. Re-measure natively on the real host once it's
  up; this is the per-tenant floor `memory.gb_hour` bills against and what
  sets how many tenants fit on one `cpx32`.
- Tenant Postgres backups (nightly `pg_dump -Fc` → R2, 7 daily + 4 weekly,
  restore drill): not yet implemented — tracked in plan 044's Open section.
