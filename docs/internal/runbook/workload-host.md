# Workload host (hosted webhooks + subgraphs, plan 044)

Internal. Not a public docs page. The permanent host for hosted chain
webhooks (044) and, once 046 lands, hosted subgraphs — one self-host stack
per tenant account, gatewayed and provisioned from this box.

Product map: [plan 044](../../../plans/044-workload-host.md) (gitignored —
see the plan index if this link 404s). Reversible: the app-server Caddy
route flips back to 404 and tenant stacks are independent compose projects,
so removing the host removes hosted webhooks without touching self-host.

**`docker/Caddyfile` stays untouched by plan 044 until the Bring-up
section's "Flip" step runs.** That file is bind-mounted into app-server's
live prod Caddy (`docker/docker-compose.hetzner.yml`); landing the
`/api/webhooks*` route on `main` before the workload host and its CA/DNS
are actually up would take down all of `api.secondlayer.tools` on the next
reload (unset `WORKLOAD_HOST_CA_FILE`, no CA file mounted, config fails to
load), and would route to a host that doesn't exist yet even if it somehow
loaded. The flip is deliberately a separate change at flip time.

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
| Volume | None — local disk. Volume dropped 2026-09-25: project volume quota exhausted by feeder-data; local disk until 046 sizing. `/opt/secondlayer-workload` (tenant secrets, one dir per acct8) and each tenant's Postgres data live on the CPX32's own 160 GB disk. |
| Cloud firewall | `workload-host`: TCP 22 from operator `136.62.99.163/32` (same IP `stacks-feeder`'s firewall already allowlists); TCP 443 from app-server `65.21.135.94/32` only. Nothing else inbound. |
| Runtime | `packages/workload` (`@secondlayer/workload`) — one Bun process, gateway + provisioner + meters, bound `127.0.0.1:8080` only. Not yet deployed to this host. |
| TLS | `docker/workload-host/Caddyfile` (its own `docker-compose.yml`, `network_mode: host`) terminates :443 with `tls internal`, addressed by `{$WORKLOAD_HOST_NAME:workload-host.secondlayer.tools}` (a real hostname, not a bare `:443` — the cert's name has to match the SNI app-server dials), and reverse-proxies to the gateway's `127.0.0.1:8080`. app-server pins that CA (`tls_trust_pool file`, `WORKLOAD_HOST_CA_FILE`) — see Bring-up steps 5–7. |
| Tenant template | `docker/workload/tenant.compose.yml` — `postgres`, `migrate`, `api`, `webhook-service`. Images `image:`-pulled from GHCR (`ghcr.io/ryanwaits/secondlayer-{api,webhook-processor}`), never built on this host. |

## Egress model (Design)

Two idempotent iptables rule sets, defined once in
`docker/workload-host/docker-user-egress.sh` (safe to re-run after a reboot
or re-provision; `bash -n`-checked) and inlined verbatim into
`cloud-init.yaml` by `provision.sh` at render time — cloud-init never holds
its own copy, so the two can't drift:

**1. `DOCKER-USER`** (the FORWARD-chain hook Docker leaves empty for
operator rules) — egress allowlist for every tenant compose network:

- Allowed: a tenant's OWN intra-network traffic (`api` ↔ `postgres` ↔
  `webhook-service` on its own bridge — matched via `-m physdev
  --physdev-is-bridged`, so this can never become a cross-tenant hole: that
  match only fires for traffic bridged on ONE network, never traffic routed
  between two different ones), app-server `65.21.135.94:443` (the gateway's
  own introspect/meters/tenant-key calls, and a tenant's `webhook-service`
  reading hosted Index/Streams), and the open public internet (a customer's
  own webhook receiver can be anywhere).
- Refused: cross-tenant traffic, blocked by interface rather than address
  range (`-i br+ -o br+ -j DROP` — routed between two different docker
  bridges, which is exactly what tenant-to-tenant looks like, since each
  tenant's compose project is its own bridge); RFC1918 (`10/8`, `172.16/12`,
  `192.168/16`), CGNAT (`100.64/10`), link-local (`169.254/16`), and loopback
  (`127/8`), each scoped `-i br+` (container-originated only — a bridged
  packet within one tenant's own network never hits these rules, because the
  physdev ACCEPT above already matched it); and the Hetzner metadata IP
  (`169.254.169.254`) explicitly, unscoped.
- The emitter's own app-level SSRF check (043,
  `packages/subgraphs/src/runtime/ssrf.ts`) stays as the first line — this
  host-level rule is the backstop, not a replacement.

**2. `WORKLOAD-INPUT`** (a dedicated chain hooked into `INPUT` for traffic
arriving via `docker0`/any `br+` interface) — `DOCKER-USER` only ever sees
FORWARDED traffic; a packet from a tenant container addressed to the HOST
itself (the bridge gateway IP — reaching the gateway's `:8080`, the control
Postgres port, or another tenant's loopback-published `api` port via that
IP) goes through `INPUT`, which `DOCKER-USER` never touches. This chain
drops every NEW connection arriving from a docker bridge, keeping only
`ESTABLISHED`/`RELATED` (replies to something the HOST itself initiated).
The gateway itself is also bound `127.0.0.1` only (review fix 7,
`Bun.serve({ hostname: "127.0.0.1", ... })`), so it is unreachable from a
bridge address even if this chain were ever bypassed — defense in depth,
not the only line.

## Bring-up

1. **Provision** (spend gate — founder go required):
   ```bash
   docker/workload-host/provision.sh --dry-run   # review the exact commands
   docker/workload-host/provision.sh             # creates the firewall, server
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
4. Deploy `packages/workload` — runs directly via `bun`, NOT in a container
   (the gateway binds `127.0.0.1:8080`; Caddy in step 5 is what actually
   terminates :443):
   ```bash
   cd /opt/secondlayer-workload
   git clone <repo> . && bun install
   # .env: CONTROL_DATABASE_URL, APP_SERVER_URL=https://api.secondlayer.tools,
   #       WORKLOAD_HOST_KEY, TENANT_SECRETS_ROOT=/opt/secondlayer-workload/tenants,
   #       TENANT_COMPOSE_FILE=docker/workload/tenant.compose.yml, GATEWAY_PORT=8080
   bun run --filter @secondlayer/workload start
   ```
5. DNS: add an A record for `workload-host.secondlayer.tools` (or whatever
   `WORKLOAD_HOST_NAME` is set to) pointing at this host's public IP. It
   never needs to be internet-reachable end to end (the cloud firewall
   still restricts :443 to app-server's IP) — it only needs to *resolve*,
   because that's the name Caddy issues its `tls internal` certificate for
   and the SNI app-server's outbound proxy call presents and then verifies
   the returned cert's name against. An `extra_hosts` entry on app-server's
   `caddy` service is a workable alternative to a real DNS record (no
   registrar step), but a DNS record is recommended: it survives app-server
   being redeployed/recreated, where a compose-file `extra_hosts` entry has
   to be remembered and re-added by hand.
6. Bring up Caddy on workload-host and extract its internal CA root — never
   a real ACME cert: there's no public DNS challenge path to this host
   (:443 is firewalled to app-server's IP only), so `tls internal` (Caddy's
   own local CA) is the right tool:
   ```bash
   # On workload-host:
   cd /opt/workload-host && docker compose -f docker/workload-host/docker-compose.yml up -d
   # First run issues the cert and generates the CA — root cert lands at:
   docker run --rm -v workload-host_caddy_data:/data alpine \
     cat /data/caddy/pki/authorities/local/root.crt > workload-host-ca.crt
   scp workload-host-ca.crt <app-server>:/opt/secondlayer/workload-host-ca.crt
   ```
   Verified locally (review fix B): `caddy:2-alpine` with this exact
   Caddyfile, `--network host`, in front of a dummy `Bun.serve` upstream on
   `127.0.0.1:8080` — Caddy's own log showed `"certificate obtained
   successfully","identifier":"workload-host.secondlayer.tools","issuer":"local"`,
   the root landed at the documented path, and
   `curl --resolve workload-host.secondlayer.tools:443:127.0.0.1 --cacert
   root.crt https://workload-host.secondlayer.tools/` printed `ok`.
7. **Flip** (a separate change, landed as its own commit at flip time — NOT
   part of plan 044's initial bring-up, so `docker/Caddyfile` stays
   untouched until this step actually runs): add the hosted-webhooks route
   to app-server's live `docker/Caddyfile`, inside the
   `api.{$BASE_DOMAIN...}` block, before the catch-all `handle {}`:
   ```caddyfile
   handle /api/webhooks* {
     reverse_proxy {$WORKLOAD_HOST_ADDR:workload-host.secondlayer.tools}:443 {
       transport http {
         tls
         tls_trust_pool file {$WORKLOAD_HOST_CA_FILE}
       }
     }
   }
   ```
   Also at flip time, on app-server: mount `workload-host-ca.crt` (copied in
   step 6) into the `caddy` service (`docker/docker-compose.hetzner.yml`'s
   volumes) and set `WORKLOAD_HOST_CA_FILE=/etc/caddy/workload-host-ca.crt`
   (path inside the container) and `WORKLOAD_HOST_ADDR` (only if the DNS
   name from step 5 isn't what's resolvable — omit it otherwise, the
   Caddyfile default already names it). Then:
   ```bash
   caddy validate --config docker/Caddyfile   # confirm before reloading — a bad
                                               # config here is all of api.secondlayer.tools
   docker compose restart caddy               # or however app-server reloads Caddy
   ```
8. Smoke test end to end (needs a real hosted account + `sk-sl_*` key):
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

**Container-to-host checks (review fix 6b — `WORKLOAD-INPUT`)**, from the
same tenant container, against the bridge gateway IP (`ip route | grep
default` inside the container gives it — typically `172.x.x.1`):

```bash
docker exec tenant-<acct8>-webhook-service-1 sh -c '
  GW=$(ip route | awk "/default/ {print \$3}")
  curl -m3 -s -o /dev/null -w "host gateway :8080: %{http_code}\n" http://$GW:8080/ || echo "host gateway :8080: blocked"
'
```

Expected: fails (connection refused/timeout) — a tenant reaching the
gateway's port directly, bypassing the gateway's own introspection/auth
entirely, would be the "any route reachable without introspection" STOP
condition.

**Tenant-to-tenant via loopback-published port (review fix 1 + 6b)**: from
tenant A, the host's own IP (not `127.0.0.1` — that's per-namespace) on
tenant B's allocated `TENANT_API_PORT` must also fail, proving a tenant
can't reach another tenant's `api` by going through the HOST instead of the
(already-blocked) bridge-to-bridge path:

```bash
docker exec tenant-<acct8-a>-webhook-service-1 sh -c '
  GW=$(ip route | awk "/default/ {print \$3}")
  curl -m3 -s -o /dev/null -w "tenant B via host IP: %{http_code}\n" http://$GW:<tenant-B-api-port>/ || echo "tenant B via host IP: blocked"
'
```

Expected: fails — `WORKLOAD-INPUT` drops it as a new connection from a
docker bridge to the host, before it could ever reach the loopback-scoped
publish rule for tenant B's port.

## Teardown

Reversible (plan's Reversible: YES) — revert the Bring-up "Flip" step's
commit on `docker/Caddyfile` (the route reverts to a 404, same as before
the flip landed), then:

```bash
hcloud server delete workload-host
hcloud firewall delete workload-host
```

No volume to delete (dropped 2026-09-25 — see the Volume row above): tenant
data lives on the server's own local disk, so deleting the server is the
whole teardown of persisted data. Each tenant stack is destroyed
independently by the provisioner
(`packages/workload/src/provisioner.ts`'s `destroy()`: `pg_dump` to R2,
`compose down -v`, secrets directory removed) — deleting the host does not
implicitly destroy tenant data ahead of that; run `destroy()` first if a
real teardown (not just a host resize/replace) is intended.

## Open

- Memory per idle tenant stack: measured locally (amd64 emulation on
  arm64, so likely somewhat high) at ~0.37–0.41 GB per tenant
  (postgres + api + webhook-service, `docker stats --no-stream`) — close to
  050's ~0.3 GB assumption. Re-measure natively on the real host once it's
  up; this is the per-tenant floor `memory.gb_hour` bills against and what
  sets how many tenants fit on one `cpx32`.
- Tenant Postgres backups (nightly `pg_dump -Fc` → R2, 7 daily + 4 weekly,
  restore drill): not yet implemented — tracked in plan 044's Open section.
