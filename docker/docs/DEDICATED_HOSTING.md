# Dedicated Hosting — Architecture & Operations Guide

This is the single reference for the dedicated-hosting product built across Sprints 4-7 of the "shared → self-hosted + dedicated" plan (`~/.claude/plans/lexical-toasting-shannon.md`).

Complements `docker/docs/OPERATIONS.md` — that doc covers env vars + the current shared prod runbook. This doc covers the architecture of dedicated hosting, how every piece fits together, and what you (the operator) need to do to run it.

Audience: someone with SSH to the Hetzner app server who has never seen this code before. Read it top-to-bottom once; after that use the code map in §9 to jump straight to files.

---

## Table of contents

- §1 What this is
- §2 Architecture overview
- §3 Components (deep dive)
- §4 End-to-end flow — clicking "Start 14-Day Trial"
- §5 Current activation state (end of Sprint 7)
- §6 Activation checklist
- §7 Troubleshooting
- §8 Recovery procedures
- §9 Code map
- §10 What's not yet done (Sprint 8 + beyond)

---

## 1. What this is

Dedicated hosting is a per-customer managed Secondlayer instance. Every customer gets their own Postgres + API + subgraph processor as dedicated Docker containers on our Hetzner app server, reachable at `{slug}.secondlayer.tools` with their own HS256-signed JWT anon/service keys.

The containers share nothing between customers (no multi-tenant schema prefixing, no `api_key_id` filtering, no shared processor). They share the blocks/transactions/events data with the rest of the platform by reading — read-only — from the shared indexer DB through a bootstrapped `secondlayer_readonly` role.

### Pricing tiers

| Plan | Price/mo | vCPU | RAM | Storage | Tenant monthly cost (our side) |
|---|---|---|---|---|---|
| Launch | $99 | 1 | 2 GB | 10 GB | ~$3 |
| Grow | $249 | 2 | 4 GB | 50 GB | ~$6 |
| Scale | $599 | 4 | 8 GB | 200 GB | ~$12 |
| Enterprise | custom | 8+ | 32+ GB | unlimited | ~$80+ |

Overage: `$2/GB/mo` beyond plan storage. No feature limits (unlimited subgraphs, streams, API calls) — Docker memory + CPU caps are the real limits.

Plan definitions live in `packages/provisioner/src/plans.ts`.

### How it differs from other modes

The same binary runs in three modes selected by the `INSTANCE_MODE` env var:

| Mode | Auth | DB model | Platform routes | Use case |
|---|---|---|---|---|
| `oss` (default) | `staticKeyAuth` (pass-through unless `API_KEY` set) | Single DB (`DATABASE_URL`) | Not mounted | `docker compose up` self-host |
| `dedicated` | `dedicatedAuth` (HS256 JWT, anon=read-only, service=full) | Dual DB (source + target) | Not mounted | Per-tenant managed instance |
| `platform` | `requireAuth` (magic-link sessions + `sk-sl_` API keys) | Single DB (source + target are the same) | Full (accounts, insights, projects, chat-sessions, tenants) | The shared control plane + dashboard host |

Mode resolution: `packages/shared/src/mode.ts:27` — `getInstanceMode()` reads `INSTANCE_MODE`, defaults to `oss`. The mode-gating that mounts/skips routes is in `packages/api/src/index.ts:51-128`.

---

## 2. Architecture overview

```
                     Dashboard (Next.js)
                            │  POST /api/tenants
                            ▼
              ┌────────────────────────────┐
              │  Platform API (platform)   │──(HTTP + PROVISIONER_SECRET)──┐
              │  /api/tenants routes       │                               │
              │  + `tenants` table         │                               ▼
              └──────┬────────────┬────────┘                 ┌────────────────────┐
                     │            │                          │   Provisioner      │
                     │            │                          │  (stateless, 3850) │
                     │            │                          │  Docker Engine API │
                     │            │                          └──────┬─────────────┘
                     │            │                                 │ /var/run/docker.sock
                     ▼            ▼                                 ▼
              Shared Postgres (source)             ┌────── sl-tenants network ─────────┐
                 - blocks                          │   sl-pg-{slug}     (Postgres)     │
                 - transactions                    │   sl-api-{slug}    (API, JWT)     │
                 - events                          │   sl-proc-{slug}   (Subgraph proc)│
                 - index_progress                  │                                   │
                 - tenants                         └───────────────────────────────────┘
                 - accounts                                         ▲
                 - api_keys                                         │  SOURCE_DATABASE_URL
                                                                    │  (readonly role)
                     ▲                                              │
                     └──────────── sl-source network ───────────────┘
```

### 2.1 Mode flag — `INSTANCE_MODE=oss|dedicated|platform`

Set per container. The app-server platform API runs with `platform`. Each tenant API + processor container runs with `dedicated`. Self-hosters run with `oss` (or omit — `oss` is the default).

| Mode value | Where it runs | Key effects |
|---|---|---|
| `oss` | Customer self-host | Auth is static-key or pass-through. No platform routes. Single DB. No tenant trial/health crons. |
| `dedicated` | Tenant containers | JWT auth with anon/service roles. Platform routes not mounted. Dual DB (source + target). |
| `platform` | App server only | Magic-link + API-key auth. All routes mounted. Tenants routes, trial + health crons active. |

Mode is resolved in `packages/shared/src/mode.ts`. Gating logic is scattered through:
- `packages/api/src/index.ts` — route mounting
- `packages/api/src/lib/ownership.ts` — `api_key_id` filtering becomes a no-op in non-platform mode
- `packages/worker/src/jobs/tenant-trial.ts:26` + `tenant-health.ts:28` — crons short-circuit outside platform mode

### 2.2 Dual-DB model

The central architectural move. Tenant processors need to read blocks/transactions/events, but we don't want N tenant indexers ingesting the same chain. So tenant containers get two DB URLs:

| URL env var | Points at | Role | Writable? |
|---|---|---|---|
| `SOURCE_DATABASE_URL` | Shared indexer DB (app-server postgres) | `secondlayer_readonly` | NO |
| `TARGET_DATABASE_URL` | Per-tenant PG (`sl-pg-{slug}`) | `secondlayer` (owner) | YES |

Which tables live where:

| Table | DB | Why |
|---|---|---|
| `blocks`, `transactions`, `events`, `index_progress` | Source | Shared chain data — indexed once for everyone |
| `accounts`, `api_keys`, `sessions`, `tenants` | Source (platform DB) | Control-plane only — only the platform API reads these |
| `subgraphs`, `jobs`, `deliveries`, `stream_metrics` | Target (per tenant) | Tenant-owned state |
| `subgraph_{name}.*` (dynamic schemas) | Target | Handler-generated tables per subgraph |

In `oss` mode both URLs default to the same pool (see `packages/shared/src/db/index.ts:22-32`). That's how one binary runs all three modes — the code always calls `getSourceDb()` / `getTargetDb()`, and in single-DB mode they return the same pool.

**Transaction safety**: block-processor (`packages/subgraphs/src/runtime/block-processor.ts`) does reads from `sourceDb` before opening a transaction, then opens a transaction only on `targetDb`. No cross-DB transaction required — reads happen outside the transaction scope.

### 2.3 Per-tenant container stack

Three containers per tenant:

| Name | Image | Role | Allocation (% of plan) |
|---|---|---|---|
| `sl-pg-{slug}` | `postgres:17-alpine` | Tenant DB. Volume: `sl-data-{slug}` mounted at `/var/lib/postgresql/data`. | 50% RAM + 50% CPU |
| `sl-api-{slug}` | `ghcr.io/{owner}/secondlayer-api:{tag}` | API in dedicated mode. Gets TENANT_JWT_SECRET, TENANT_SLUG, SOURCE_DATABASE_URL (readonly), TARGET_DATABASE_URL. Health `/health`. | 20% RAM + 20% CPU |
| `sl-proc-{slug}` | Same image, `cmd: bun run packages/subgraphs/src/service.ts` | Subgraph processor. Dual-DB: reads blocks from source, writes subgraph data to target. | 30% RAM + 30% CPU |

Example for a Launch tenant (2 GB, 1 vCPU):
- PG: 1024 MB, 0.5 vCPU
- Processor: 614 MB, 0.3 vCPU
- API: 409 MB, 0.2 vCPU

Worker containers are **not** per-tenant — there's one shared worker on the app server that runs tenant-trial + tenant-health crons. Worker jobs were descoped from the per-tenant model (see `packages/shared/migrations/0038_drop_workflow_tables.ts` — workflows went on the back burner, simplifying the tenant footprint).

Allocations computed by `alloc()` in `packages/provisioner/src/plans.ts:35-50`.

### 2.4 Docker networks

Two bridge networks defined by the provisioner (created on first provision; idempotent):

| Network | Members | Purpose |
|---|---|---|
| `sl-tenants` | Platform API, Provisioner, Traefik, all `sl-{role}-{slug}` containers | Platform → provisioner calls; Traefik → tenant API routing; tenant API/proc → tenant PG |
| `sl-source` | Shared app-server postgres + tenant API/proc containers | Tenants read blocks/txs/events from the shared indexer DB. Tenant PG is NOT on this network. |

Defined in `packages/provisioner/src/names.ts:32-33`:

```typescript
export const NETWORK_TENANTS = "sl-tenants";
export const NETWORK_SOURCE = "sl-source";
```

Platform-side compose declaration lives in `docker/docker-compose.dedicated.yml:100-115` — the provisioner also creates them if missing (`networkEnsure()` in `packages/provisioner/src/provision.ts:62-65`).

### 2.5 Readonly role (`secondlayer_readonly`)

Bootstrapped by the provisioner on startup against the shared source DB. The code:
- Role: `secondlayer_readonly` (constant)
- Password: `PROVISIONER_SOURCE_DB_READONLY_PASSWORD` (env)
- Grants: `CONNECT` on the source DB, `USAGE` on `public`, `SELECT ON ALL TABLES IN SCHEMA public`, `ALTER DEFAULT PRIVILEGES ... GRANT SELECT` so new tables auto-grant.

Source: `packages/provisioner/src/readonly-role.ts:19-51`.

Rotation: change `PROVISIONER_SOURCE_DB_READONLY_PASSWORD` in `.env`, restart the provisioner. The `ALTER ROLE ... WITH PASSWORD` is idempotent and runs on every boot. Existing tenant containers still hold the old URL in their env — they'll keep working until next resize (which rebuilds the API container and reads `buildSourceReadonlyUrl()` from the provisioner's current config).

**Important**: the readonly URL contains the password in the connection string, so tenant containers see it via their `SOURCE_DATABASE_URL` env. This is acceptable — the role only has SELECT, so compromise of a tenant container can't corrupt source data.

### 2.6 Auth modes in detail

Defined in `packages/api/src/middleware/auth-modes.ts`. Applied by `resourceAuth()` in `packages/api/src/index.ts:51-55`.

| Factory | Used in mode | Behavior |
|---|---|---|
| `noAuth()` | Never mounted by index.ts (available for future use) | Pass-through |
| `staticKeyAuth()` | `oss` | If `API_KEY` env unset → pass-through. If set → requires `Authorization: Bearer $API_KEY`. |
| `dedicatedAuth()` | `dedicated` | Verifies HS256 JWT using `TENANT_JWT_SECRET`. Role claim = `anon` (GET-only) or `service` (all methods). Sets `c.var.tenantRole`. |
| `requireAuth()` (from `@secondlayer/auth`) | `platform` | Magic-link sessions + `sk-sl_` API keys. |

JWT payload shape (see `packages/provisioner/src/jwt.ts:12`):

```typescript
{
  role: "anon" | "service",
  sub: "{slug}",       // tenant slug
  iat: <unix seconds>,
  exp?: <unix seconds>  // currently unset — long-lived keys
}
```

Keys are minted at provision time by `mintTenantKeys()` in `packages/provisioner/src/jwt.ts:56-70`, persisted encrypted in the `tenants` table by the platform API, and shown once to the user in sessionStorage.

### 2.7 Naming conventions

| Resource | Pattern | Example |
|---|---|---|
| Tenant slug | 8-char lowercase `[0-9a-z]` | `xk4m2n7p` |
| Postgres container | `sl-pg-{slug}` | `sl-pg-xk4m2n7p` |
| API container | `sl-api-{slug}` | `sl-api-xk4m2n7p` |
| Processor container | `sl-proc-{slug}` | `sl-proc-xk4m2n7p` |
| Data volume | `sl-data-{slug}` | `sl-data-xk4m2n7p` |
| Public URL | `https://{slug}.{PROVISIONER_TENANT_BASE_DOMAIN}` | `https://xk4m2n7p.secondlayer.tools` |
| Internal URL | `http://sl-api-{slug}:3800` | `http://sl-api-xk4m2n7p:3800` |

All naming helpers live in `packages/provisioner/src/names.ts`. Slug generation uses `crypto.randomBytes` — collision probability negligible (`36^8 ≈ 2.8 × 10^12` possible slugs).

Container labels applied at create time (see `packages/provisioner/src/provision.ts:225-232, 271-280`):

```
secondlayer.role=postgres|api|processor
secondlayer.slug={slug}
secondlayer.plan={plan}
traefik.enable=true                                           (api only)
traefik.http.routers.{slug}.rule=Host(`{slug}.{domain}`)      (api only)
traefik.http.routers.{slug}.tls.certresolver=letsencrypt      (api only)
traefik.http.services.{slug}.loadbalancer.server.port=3800    (api only)
```

Traefik labels are set at provision time — they're inert until Traefik actually deploys (Sprint 6, not yet live).

---

## 3. Components (deep dive)

### 3.1 Provisioner service — `packages/provisioner/`

A stateless HTTP service that speaks to the Docker Engine API (via `/var/run/docker.sock`) to provision, resize, suspend, and tear down tenant container stacks. Runs on port **3850**, gated by the shared `PROVISIONER_SECRET` header.

**Why stateless**: the control plane (platform API `tenants` table) owns persistent tenant state. The provisioner just does Docker ops + returns values. If the provisioner loses its state, redeployment is safe — all tenant containers keep running, and the platform API can re-query them through the same Docker Engine API on any restart.

Source files:

| File | Purpose |
|---|---|
| `config.ts` | Runtime config parsed once at startup; fails fast if required env missing. |
| `plans.ts` | `PLANS` record + `alloc()` helper computing per-container memory/CPU splits. |
| `names.ts` | Slug generation + deterministic container/volume names; network name constants. |
| `types.ts` | Public contract: `TenantResources`, `TenantStatus`, `ProvisionError`. |
| `docker.ts` | Thin typed Docker Engine API client. Unix-socket HTTP via `fetch(url, { unix })`. Narrow surface: pull, networks, volumes, containers, exec, stats. |
| `readonly-role.ts` | Bootstraps `secondlayer_readonly` role on source DB + builds tenant source URL. |
| `migrations.ts` | Spawns a short-lived migrator container of the API image against the tenant DB. |
| `jwt.ts` | HS256 JWT minting — `signHs256Jwt`, `generateTenantSecret`, `mintTenantKeys`. |
| `provision.ts` | The orchestrator. Stage-annotated sequence with best-effort cleanup on failure. |
| `teardown.ts` | Stop + rm all tenant containers; optional volume remove. |
| `lifecycle.ts` | `suspendTenant`, `resumeTenant`, `resizeTenant` (recover env → recreate with new limits), `getTenantStatus`. |
| `storage.ts` | `measureStorageMb` via `pg_database_size()`. |
| `routes.ts` | Hono HTTP routes; every route gated by `x-provisioner-secret` header. |
| `index.ts` | Boot sequence: parse config → bootstrap readonly role → start Bun.serve. |

HTTP API:

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness (no secret required). |
| POST | `/tenants` | Provision a new tenant. Body: `{ accountId, plan }`. Returns `TenantResources`. |
| GET | `/tenants/:slug?plan=launch` | Live container status + per-container stats. |
| DELETE | `/tenants/:slug?deleteVolume=true\|false` | Teardown. |
| POST | `/tenants/:slug/suspend` | Stop containers, preserve volume. |
| POST | `/tenants/:slug/resume` | Start containers. |
| POST | `/tenants/:slug/resize` | Body: `{ newPlan }`. Recreate containers with new limits. |
| GET | `/tenants/:slug/storage?url=...` | `pg_database_size()` in MB. Caller passes the stored tenant DB URL (provisioner is stateless). |

**Required env vars** (checked in `config.ts`):

```bash
PROVISIONER_SECRET=<hex32>                           # X-Provisioner-Secret header value
PROVISIONER_SOURCE_DB_ADMIN_URL=postgres://...        # full admin URL to shared source DB
PROVISIONER_SOURCE_DB_READONLY_PASSWORD=<hex24>       # password the provisioner sets on the readonly role
PROVISIONER_SOURCE_DB_HOST=postgres:5432              # host:port tenants use to reach source DB (default sl-pg-source:5432)
PROVISIONER_SOURCE_DB_NAME=secondlayer                # default secondlayer
PROVISIONER_IMAGE_TAG=latest                          # GHCR tag for tenant images
PROVISIONER_IMAGE_OWNER=secondlayer-labs              # GHCR owner
PROVISIONER_TENANT_BASE_DOMAIN=secondlayer.tools      # for Traefik labels
DOCKER_SOCKET=/var/run/docker.sock                    # override for non-standard socket paths
PROVISIONER_PORT=3850                                 # override if you need a different port
```

The provisioner boot sequence (`packages/provisioner/src/index.ts:8-35`):

1. `getConfig()` — throws on missing required env
2. `bootstrapReadonlyRole()` — creates or alters `secondlayer_readonly` on source DB; fails fast if admin creds are wrong
3. `app.route("/", buildRoutes())` + `Bun.serve({ port })` — start accepting HTTP

**Docker socket access**: the provisioner container gets `/var/run/docker.sock` bind-mounted. This gives root-equivalent control over the host Docker daemon. Only deploy on hosts where that's acceptable (same risk model as the agent container which does the same).

**Stage-annotated provision (`provision.ts:62-138`)**: every step is wrapped in a `stage(name, slug, fn)` helper that catches the underlying error and re-throws a `ProvisionError` annotated with the failing stage (`"network"`, `"volume"`, `"postgres"`, `"migrate"`, `"api"`, `"processor"`). On failure, `teardownTenant(slug, { deleteVolume: true })` runs best-effort before the error bubbles up to the route handler. Stages are observable via log output — grep for `slug=xxxxxxxx` in provisioner logs to see the exact failure point.

**Resize-via-recreate (`lifecycle.ts:62-146`)**: no in-place Docker resize. Tenant creds (DB password, JWT secret) are **recovered from the existing API container's env** via `containerInspect` → `Config.Env`. Then containers are stopped + removed, then recreated with new sizes. Volume preserved; brief downtime (~30s).

### 3.2 Platform API tenants routes — `packages/api/src/routes/tenants.ts`

Four endpoints mounted at `/api/tenants/*`, only in `platform` mode (see `packages/api/src/index.ts:126`).

| Method | Path | Action |
|---|---|---|
| POST | `/api/tenants` | Validate plan, check for existing tenant (one-per-account), call provisioner, encrypt + insert result into `tenants` table, return creds once. |
| GET | `/api/tenants/me` | Look up by account_id, fetch live status from provisioner, return public view + runtime. |
| POST | `/api/tenants/me/resize` | Validate plan, call provisioner resize, update row in `tenants`. |
| DELETE | `/api/tenants/me` | Call provisioner teardown (volume preserved), set status to `suspended`. 30-day data retention. |

Upstream dependency: `packages/api/src/lib/provisioner-client.ts` — typed HTTP wrapper around the provisioner's HTTP API. Reads `PROVISIONER_URL` + `PROVISIONER_SECRET` from env every call (not cached) — allows in-place secret rotation without restarting.

All routes use `getAccountId(c)` from `packages/api/src/lib/ownership.ts` — the account must be authenticated (platform auth applied upstream in `packages/api/src/index.ts:111-112`).

The `publicView()` helper (`packages/api/src/routes/tenants.ts:234-248`) explicitly excludes encrypted columns from the response — credentials only surface once at provision time via the `credentials` field in the POST response.

### 3.3 Tenants table — `packages/shared/migrations/0039_tenants.ts`

```sql
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'provisioning',  -- provisioning|active|suspended|error|deleted

  plan text NOT NULL,
  cpus numeric(4,2) NOT NULL,
  memory_mb integer NOT NULL,
  storage_limit_mb integer NOT NULL,
  storage_used_mb integer,

  pg_container_id text,
  api_container_id text,
  processor_container_id text,

  target_database_url_enc bytea NOT NULL,
  tenant_jwt_secret_enc bytea NOT NULL,
  anon_key_enc bytea NOT NULL,
  service_key_enc bytea NOT NULL,

  api_url_internal text NOT NULL,
  api_url_public text NOT NULL,

  trial_ends_at timestamptz NOT NULL,
  suspended_at timestamptz,
  last_health_check_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Three indexes (partial, for cron performance):
- `tenants_account_idx` on `(account_id)`
- `tenants_status_idx` on `(status) WHERE status <> 'deleted'`
- `tenants_trial_ends_idx` on `(trial_ends_at) WHERE status IN ('provisioning', 'active')`

Status lifecycle:
```
provisioning ──(provision OK)──▶ active ──(trial expires)──▶ suspended ──(30d)──▶ deleted
     │                               │                           │
     └─(provision fail)──▶ error     └─(health check fail)──▶ error
```

Encrypted columns (`_enc` suffix) use AES-GCM envelope encryption via `packages/shared/src/crypto/secrets.ts`, keyed by `SECONDLAYER_SECRETS_KEY`. Never log plaintext from these. `getTenantCredentials()` is the only helper that returns plaintext — call it only when handing creds to an authorized caller (dashboard, CLI).

Query helpers: `packages/shared/src/db/queries/tenants.ts`:
- `insertTenant`
- `getTenantByAccount`
- `getTenantBySlug`
- `listTenantsByStatus`
- `listExpiredTrials`
- `listSuspendedOlderThan`
- `setTenantStatus` (auto-fills `suspended_at` on transition)
- `recordHealthCheck`
- `updateTenantPlan`
- `getTenantCredentials` (the only one that returns plaintext)

### 3.4 Worker crons — `packages/worker/src/jobs/`

Two crons, both gated on `getInstanceMode() === 'platform'`. They share the thin provisioner client `provisioner-rpc.ts` (a stripped-down copy of the API-side client, to avoid cross-service package imports).

#### tenant-trial.ts — hourly

| Tick | Action |
|---|---|
| Every 1h (first run 1min post-boot) | `suspendExpiredTrials()` — select tenants where `trial_ends_at < now()` and status in `(provisioning, active)`; call provisioner's `POST /tenants/{slug}/suspend`; set status to `suspended`. |
| Every 1h | `purgeOldSuspended()` — select tenants where `suspended_at < now() - 30d` and status = `suspended`; call provisioner's `DELETE /tenants/{slug}?deleteVolume=true`; set status to `deleted`. |

Lazy import of the provisioner-rpc module — `await import("./provisioner-rpc.ts")` only when there's work to do. Keeps the OSS boot path from requiring `PROVISIONER_URL`.

#### tenant-health.ts — every 2 minutes

| Tick | Action |
|---|---|
| Every 2m (first run 45s post-boot) | For each `status='active'` tenant: poll provisioner `GET /tenants/{slug}`; if any container state is not `running`/`restarting`, mark status=`error`. Otherwise decrypt `target_database_url_enc` via `getTenantCredentials`, poll `GET /tenants/{slug}/storage`, `recordHealthCheck(slug, storage.sizeMb)`. Warn when `storage.sizeMb > 80% of storage_limit_mb`. |

Current alert plumbing: `logger.warn(...)` only. Formal alerting (Slack/email) is TBD — the platform agent already wires up Slack, but tenant-specific hooks aren't routed through it yet. Post-MVP.

### 3.5 Dashboard Instance page — `apps/web/src/app/platform/instance/`

Two files:
- `page.tsx` (server) — reads session cookie, calls `apiRequest("/api/tenants/me")`, passes `{tenant, runtime}` into the client component.
- `instance-view.tsx` (client) — the whole user-facing flow.

Routing: the URL is `/instance`, which Next.js middleware (`apps/web/src/middleware.ts:53-56`) rewrites to `/platform/instance`. Unauthenticated visits redirect to `/`. `/instance` is in both `AUTH_REQUIRED` (line 13) and the matcher (lines 82-83).

Component tree when no tenant exists:
```
<InstanceView/>
  └── <TrialStart/>
        ├── Plan radio group (launch/grow/scale)
        └── "Start 14-Day Trial" button  ───POST /api/tenants───▶
```

Component tree when tenant exists:
```
<InstanceView/>
  ├── <TrialBanner/>        (warning when ≤3 days left; error when expired/suspended)
  ├── <InstanceSummary/>    (slug, plan, cpus/RAM/storage specs, status, created_at)
  ├── <ResourceGauges/>     (CPU%, Memory%, Storage% from runtime stats)
  ├── <ConnectionSnippets/> (tabs: curl | node | cli)
  └── <ResizeSection/>      (plan dropdown → POST /api/tenants/me/resize)
```

**Credential display**: after provision, `showCredsOnce()` writes `{apiUrl, anonKey, serviceKey, ts}` to `window.sessionStorage` under key `sl.creds.oneshot` and logs to console. There is currently no modal — the reveal is informal. User is expected to read from console or sessionStorage within the first minute. TODO in the code. Regeneration path not yet implemented either — `ConnectionSnippets` notes "Regenerate at any time from this page" but the button isn't wired up.

Next.js proxy routes (forward session-auth request to backend):
- `apps/web/src/app/api/tenants/route.ts` — POST passthrough; `revalidateTag("tenant", { expire: 0 })` on success.
- `apps/web/src/app/api/tenants/me/route.ts` — GET + DELETE passthrough. 404 is mapped to `{tenant: null}` with 200 status (so the page treats "no tenant" as a normal state, not an error).
- `apps/web/src/app/api/tenants/me/resize/route.ts` — POST passthrough; `revalidateTag("tenant")` on success.

### 3.6 CLI `sl instance connect` — `packages/cli/src/commands/instance.ts`

Three subcommands:

| Command | Action |
|---|---|
| `sl instance connect <url> --key <key>` | Validates URL shape; pings `GET <url>/api/subgraphs` with the key; on success writes `apiUrl` + `apiKey` into `~/.config/secondlayer/config.json`. |
| `sl instance status` | Prints current `apiUrl` + first 10 chars of `apiKey`. |
| `sl instance disconnect` | Clears `apiUrl` + `apiKey` from config. |

The connection check uses `res.status === 401|403` to detect bad keys specifically — better UX than a generic "failed" message.

After `connect`, downstream commands (`sl subgraphs deploy`, etc.) pick up the configured `apiUrl` + `apiKey` automatically.

### 3.7 Traefik — `docker/traefik/traefik.yml` + `docker/docker-compose.dedicated.yml`

**Reverse proxy for dedicated hosting.** Docker provider auto-discovers tenant containers via labels (set by the provisioner at container-create time). DNS-01 challenge via Cloudflare gets a wildcard cert for `*.secondlayer.tools`.

`traefik.yml` static config:
- Entry points: `web` (:80 — redirects to https) + `websecure` (:443 — TLS)
- Docker provider on `sl-public` network with `exposedByDefault: false`
- Cert resolver `letsencrypt` with DNS-01 via Cloudflare
- Dashboard exposed only on `127.0.0.1:8080` (not public)
- Prometheus metrics enabled

Tenant routing labels (already applied by provisioner, inert until Traefik deploys) — see `packages/provisioner/src/provision.ts:275-280`:

```
traefik.enable=true
traefik.http.routers.{slug}.rule=Host(`{slug}.secondlayer.tools`)
traefik.http.routers.{slug}.tls.certresolver=letsencrypt
traefik.http.services.{slug}.loadbalancer.server.port=3800
```

Platform API labels (defined in `docker-compose.dedicated.yml:50-59`) — inert until Traefik deploys and Caddy stops:

```
traefik.http.routers.platform-api.rule=Host(`api.secondlayer.tools`)
traefik.http.routers.platform-api.entrypoints=websecure
traefik.http.routers.platform-api.tls.certresolver=letsencrypt
traefik.http.services.platform-api.loadbalancer.server.port=3800
```

Admin dashboard at `traefik.secondlayer.tools` protected by basic auth (users in `TRAEFIK_DASHBOARD_USERS` env; generated via `htpasswd -nb admin <password>`).

**Not deployed yet**. `docker-compose.dedicated.yml` is parallel to the live `docker-compose.hetzner.yml` — cutover is a separate maintenance step after DNS + cert verification (§6).

### 3.8 Deploy pipeline — `docker/scripts/deploy.sh`

Hardened across Sprints 5-7 to make migrations reliable. Called by the GitHub SSH action on every push to main.

Order:

| Step | What | Why |
|---|---|---|
| 1 | `git fetch origin main; git reset --hard origin/main` | Source update |
| 2 | `exec bash ...` (re-exec self) | Avoids bash buffering old script content against new compose files |
| 3 | `docker compose build --no-cache api indexer worker subgraph-processor agent migrate` | Rebuild images |
| 4 | `docker compose stop api subgraph-processor agent worker` | Only services that hold locks on migrated tables. Indexer stays up (its tables — blocks/transactions/events/index_progress — are independent of subgraphs/workflow_* tables that migrations touch). |
| 5 | `docker rm -f secondlayer-view-processor-1 secondlayer-workflow-runner-1` | Force-remove orphan containers from removed services — old workflow-runner, etc. |
| 6 | `docker ps -a --filter "label=com.docker.compose.oneoff=True" --filter "label=com.docker.compose.service=migrate" -q \| xargs -r docker rm -f` | Zombie migrate containers from prior deploys killed by SSH timeout — hold kysely's advisory migration lock. |
| 7 | `pg_terminate_backend(pid)` for every non-self session | TCP-half-closed session cleanup. Indexer (which we kept running) auto-reconnects. |
| 8 | `docker compose run --rm migrate` | Migrations. The migrate entrypoint sets `statement_timeout=60s` + `lock_timeout=30s` so failure is loud and quick. |
| 9 | Diagnostic `pg_stat_activity` dump on failure | See who held the lock when we timed out. |
| 10 | `docker compose up -d --remove-orphans api indexer worker subgraph-processor agent caddy` | Restart |
| 11 | Curl `/health` with retry | Verify api + indexer come back |

Typical deploy: 60-90s. Failures now surface in ≤60s, not silent 5-min timeouts.

---

## 4. End-to-end flow — "Start 14-Day Trial"

Starting from a fresh account with no tenant. User clicks the button in the dashboard. Here's every step, file by file.

### Step 1 — Browser click

`apps/web/src/app/platform/instance/instance-view.tsx:116-138` (`TrialStart.handleStart`):
```typescript
const res = await fetch("/api/tenants", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
  body: JSON.stringify({ plan: selected })
});
```

### Step 2 — Next.js proxy route

`apps/web/src/app/api/tenants/route.ts:5-25`. Reads `sl_session` cookie → calls `apiRequest("/api/tenants", { method: "POST", body, sessionToken })` which forwards to the backend platform API with the session token in the header.

### Step 3 — Platform API route handler

`packages/api/src/routes/tenants.ts:44-131` (`POST /api/tenants`):
1. `getAccountId(c)` — extract accountId from the auth context already set upstream
2. `getTenantByAccount(getDb(), accountId)` — reject with 409 if one exists (one-per-account rule)
3. Parse + validate `plan` against `VALID_PLANS`
4. Call `provisionerProvision({ accountId, plan })` — HTTP POST to provisioner

### Step 4 — Provisioner orchestrates Docker

`packages/provisioner/src/provision.ts:45-164` (`provisionTenant`). Stage-annotated sequence:

| # | Stage | What |
|---|---|---|
| 1 | `network` | `networkEnsure('sl-tenants')`, `networkEnsure('sl-source')` — idempotent create |
| 2 | `api` (image pull) | `pullImage('ghcr.io/{owner}/secondlayer-api:{tag}')` |
| 3 | `volume` | `volumeEnsure('sl-data-{slug}')` |
| 4 | `postgres` | Build spec → `containerCreate` → `containerStart` → `waitForHealthy(60s)` on `pg_isready` |
| 5 | `migrate` | Spawn short-lived `sl-pg-{slug}-migrator` container running `bun run packages/shared/src/db/migrate.ts` against tenant DB; wait for exit; remove |
| 6 | `api` | Build spec (env: `INSTANCE_MODE=dedicated`, dual-DB URLs, `TENANT_JWT_SECRET`, Traefik labels) → create → start → `waitForHealthy(30s)` on `/health` |
| 7 | `processor` | Same image, `cmd: bun run packages/subgraphs/src/service.ts` → create → start → `waitForHealthy(20s)` |
| 8 | — | `mintTenantKeys(slug, jwtSecret)` → `{anonKey, serviceKey}` |
| 9 | — | Return `TenantResources` |

On any failure: `teardownTenant(slug, { deleteVolume: true })` runs best-effort, error re-thrown annotated with failing stage.

### Step 5 — Platform API persists

Back in `packages/api/src/routes/tenants.ts:88-112`:
```typescript
const trialEndsAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);
const alloc = PLAN_ALLOCATIONS[plan];

const tenant = await insertTenant(getDb(), {
  accountId, slug: provisioned.slug, plan,
  cpus: alloc.cpus, memoryMb: alloc.memoryMb, storageLimitMb: alloc.storageLimitMb,
  pgContainerId: provisioned.containerIds.postgres,
  apiContainerId: provisioned.containerIds.api,
  processorContainerId: provisioned.containerIds.processor,
  targetDatabaseUrl: provisioned.targetDatabaseUrl,       // will be encrypted
  tenantJwtSecret: provisioned.tenantJwtSecret,           // will be encrypted
  anonKey: provisioned.anonKey,                           // will be encrypted
  serviceKey: provisioned.serviceKey,                     // will be encrypted
  apiUrlInternal: provisioned.apiUrlInternal,
  apiUrlPublic: provisioned.apiUrlPublic,
  trialEndsAt,
});
```

`insertTenant` (`packages/shared/src/db/queries/tenants.ts:33-61`) calls `encryptSecret()` on the four sensitive fields before insert.

### Step 6 — Response back to browser

Platform API returns 201 with `{ tenant: publicView(...), credentials: {apiUrl, anonKey, serviceKey} }`. Dashboard proxy route calls `revalidateTag("tenant")` so subsequent `GET /api/tenants/me` reads fresh data.

### Step 7 — Client stashes creds

`instance-view.tsx:557-573` (`showCredsOnce`):
```typescript
window.sessionStorage.setItem(
  "sl.creds.oneshot",
  JSON.stringify({ ...creds, ts: Date.now() })
);
console.log("[secondlayer] Provision complete. Credentials:", creds);
```

Page re-renders with `InstanceSummary` + `ConnectionSnippets` visible; user is expected to copy the service key immediately. Closing/navigating clears sessionStorage; no second chance without a regenerate flow (TODO).

Total elapsed time: typically 30-60s (image pull dominates if not cached; ~15s otherwise). The button label during provisioning is `"Provisioning… (30-60s)"`.

---

## 5. Current activation state (end of Sprint 7)

What's **running right now on the Hetzner app server** (`INSTANCE_MODE=platform`):

| Container | Role | Notes |
|---|---|---|
| `secondlayer-postgres-1` | Shared indexer + control-plane DB | Will become the "source" DB once dedicated hosting activates |
| `secondlayer-api-1` | Platform API | All routes mounted including `/api/tenants/*` |
| `secondlayer-indexer-1` | Block/tx/event ingestion | Writes to shared DB |
| `secondlayer-subgraph-processor-1` | Shared processor | Will be decommissioned once all users migrate (Sprint 8) |
| `secondlayer-worker-1` | Storage cron + tenant trial/health crons (latter short-circuit with 0 tenants) | |
| `secondlayer-agent-1` | AI ops monitoring + Slack | |
| `secondlayer-caddy-1` | TLS proxy for `api.secondlayer.tools` | Will be replaced by Traefik on cutover |

What's **deployed but dormant**:

| Piece | Status | Activation requires |
|---|---|---|
| `tenants` table | Migrated (`0039_tenants`), empty | Just usage — creating a tenant |
| `/api/tenants/*` routes | Mounted in API | Nobody's calling them yet |
| Worker tenant-trial cron | Running, short-circuits (no tenants in DB) | — |
| Worker tenant-health cron | Running, short-circuits (no tenants in DB) | — |
| Instance dashboard page | Deployed at `/instance` | Currently 404s with `{tenant: null}` — `TrialStart` view. Fully functional for provisioning if provisioner were running. |
| Provisioner Traefik labels on tenant containers | Code paths hit on every provision | Inert — no Traefik |

What's **NOT deployed**:

| Piece | Why |
|---|---|
| Provisioner service | Behind `--profile platform` in base compose; current `deploy.sh` doesn't include that profile |
| Traefik | Parallel `docker-compose.dedicated.yml` not in use; prod still on Caddy |
| Tenant containers | Can't exist without a running provisioner |

**Net effect**: if a user navigates to `/instance` right now and clicks "Start 14-Day Trial", the platform API will try to call the provisioner at `http://provisioner:3850`, fail (no DNS resolution — no provisioner running), and return a 502 with `"Provisioner rejected the request"`. Non-destructive — no tenant state was created.

---

## 6. Activation checklist

### 6.1 Go live with dedicated hosting (provisioner only, no Traefik)

1. **Generate secrets** (on your local machine):
   ```bash
   openssl rand -hex 32   # PROVISIONER_SECRET
   openssl rand -hex 24   # PROVISIONER_SOURCE_DB_READONLY_PASSWORD
   ```

2. **Add to `/opt/secondlayer/docker/.env`**:
   ```bash
   PROVISIONER_SECRET=<hex32 from step 1>
   PROVISIONER_URL=http://provisioner:3850
   PROVISIONER_SOURCE_DB_READONLY_PASSWORD=<hex24 from step 1>
   PROVISIONER_SOURCE_DB_HOST=postgres:5432
   PROVISIONER_TENANT_BASE_DOMAIN=secondlayer.tools
   PROVISIONER_IMAGE_TAG=latest
   PROVISIONER_IMAGE_OWNER=secondlayer-labs
   ```
   `PROVISIONER_URL` + `PROVISIONER_SECRET` are read by the API + worker for outbound calls. The `PROVISIONER_*` prefix vars are read by the provisioner itself.

3. **Build the provisioner image**:
   ```bash
   cd /opt/secondlayer/docker
   COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
   $COMPOSE build provisioner
   ```

4. **Start the provisioner**:
   ```bash
   $COMPOSE --profile platform up -d provisioner
   ```

5. **Verify health** (should return `{"ok":true,"version":"0.1.0"}`):
   ```bash
   curl http://localhost:3850/health
   ```
   If not reachable: `$COMPOSE logs provisioner` — most common failure is bad `PROVISIONER_SOURCE_DB_ADMIN_URL` or missing `PROVISIONER_SECRET`.

6. **Verify the readonly role** was bootstrapped:
   ```bash
   docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
     -c "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'secondlayer_readonly';"
   ```
   Should return one row.

7. **Restart the worker + API** so they pick up the new `PROVISIONER_*` env vars:
   ```bash
   $COMPOSE up -d --force-recreate api worker
   ```

8. **Done.** Users can now create tenants from the dashboard. Each provision spawns `sl-pg-{slug}`, `sl-api-{slug}`, `sl-proc-{slug}` on the host.

### 6.2 Enable Traefik (Sprint 6 work, still deferred)

Only do this once tenants are actually running on the host and you're ready to serve them on their public subdomains.

1. **Cloudflare API token**: Zone:DNS:Edit scope on `secondlayer.tools`.
2. **Add to `.env`**:
   ```bash
   CF_API_TOKEN=<cloudflare token>
   TRAEFIK_ACME_EMAIL=ops@secondlayer.tools
   TRAEFIK_DASHBOARD_USERS=<htpasswd -nb admin PASSWORD output, escaped for compose>
   ```
3. **Add wildcard DNS**: A record `*.secondlayer.tools` → app server IP. Also add `api.secondlayer.tools` and `traefik.secondlayer.tools` if they don't already resolve.
4. **Deploy Traefik** (parallel to Caddy — no conflict since Caddy and Traefik both want :80/:443 so this step conflicts; do it during a maintenance window):
   ```bash
   cd /opt/secondlayer/docker
   COMPOSE_DEDICATED="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml -f docker-compose.dedicated.yml"
   # Stop Caddy first (it holds :443)
   docker compose -f docker-compose.yml -f docker-compose.hetzner.yml stop caddy
   # Bring up Traefik
   $COMPOSE_DEDICATED --profile platform up -d traefik
   ```
5. **Verify a tenant subdomain**. Create a test tenant first via dashboard, then:
   ```bash
   curl -I https://<test-slug>.secondlayer.tools
   # Expect 401 (unauthenticated) — confirms TLS cert + routing work.
   ```
6. **Verify platform API**:
   ```bash
   curl -I https://api.secondlayer.tools/health
   # Expect 200.
   ```
7. **Update `deploy.sh`** to use the dedicated compose pair:
   ```bash
   # Change line 28 in deploy.sh:
   COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml -f docker-compose.dedicated.yml"
   ```
   Commit + push so the next auto-deploy uses the new pair. Alternative: SSH-in and persist the override locally, but a committed change is preferable.
8. **Remove Caddy** once confident (also removable from `docker-compose.hetzner.yml:51-65`; do in a separate PR).

---

## 7. Troubleshooting

### Provisioner won't start

Run `docker compose -f docker-compose.yml -f docker-compose.hetzner.yml logs provisioner`. Common failures:

| Log snippet | Cause | Fix |
|---|---|---|
| `Missing required env var: PROVISIONER_SECRET` | Env var unset in `.env` or compose didn't read it | Check `.env`, restart |
| `Failed to bootstrap source DB readonly role` + password auth error | Bad `PROVISIONER_SOURCE_DB_ADMIN_URL` | Fix admin URL — format `postgres://user:pass@host:5432/db` |
| `Failed to bootstrap ... permission denied to create role` | Admin URL isn't using an admin-role URL | Use a role with `CREATEROLE` or superuser |
| `ENOENT: no such file or directory /var/run/docker.sock` | Docker socket not bind-mounted | Check `volumes:` in compose — needs `/var/run/docker.sock:/var/run/docker.sock` |

### Tenant provision fails at `postgres` stage

Typical cause: tenant PG memory limit exceeds host available. Container create succeeds; `waitForHealthy` times out because the container OOM-killed.

```bash
# Check host free memory
free -h
# Check tenant container last exit
docker inspect sl-pg-{slug} | jq '.[0].State'
# Check per-container memory limit vs actual
docker stats --no-stream sl-pg-{slug}
```

Fix: use a smaller plan (Launch is 2 GB total, PG gets 1 GB). If host is already tight, consider whether you have room for another tenant.

### Tenant provision fails at `migrate` stage

The migrator container ran but exited non-zero (or never exited within 2 min). The API image contains the migration script at `packages/shared/src/db/migrate.ts`.

```bash
# Look at the migrator container's last output — it gets deleted after run, but
# if you catch it in flight:
docker logs sl-pg-{slug}-migrator
```

If you missed it: the tenant DB is accessible at `sl-pg-{slug}:5432` from any container on `sl-tenants`. Shell in and run migrations manually:
```bash
docker run --rm --network sl-tenants \
  -e DATABASE_URL="postgres://secondlayer:<password>@sl-pg-{slug}:5432/secondlayer" \
  ghcr.io/secondlayer-labs/secondlayer-api:latest \
  bun run packages/shared/src/db/migrate.ts
```

Most common: source DB unreachable from the tenant network (the migrator only needs the TARGET url, so this is mostly a non-issue). Check API image contains the migration entrypoint:
```bash
docker run --rm ghcr.io/secondlayer-labs/secondlayer-api:latest ls packages/shared/src/db/
```

### Tenant containers running but API unreachable

The tenant is alive but users can't reach it:
```bash
docker ps --filter "label=secondlayer.slug={slug}"
# Shows all 3 containers Running?
curl http://sl-api-{slug}:3800/health --unix-socket /var/run/docker.sock  # won't work — internal only
# From the host:
docker exec secondlayer-api-1 curl -sf http://sl-api-{slug}:3800/health
```

If the container is healthy from inside the network but unreachable externally:
- Traefik not running → §6.2 activation checklist
- Wildcard DNS not resolving → `dig {slug}.secondlayer.tools` from outside
- Cert not issued → `docker logs secondlayer-traefik-1 | grep -i acme`

### Worker crons spamming errors

Look at `docker logs secondlayer-worker-1 --tail 50`.

| Error pattern | Cause | Fix |
|---|---|---|
| `PROVISIONER_URL and PROVISIONER_SECRET are required` | Worker booted before env was set | Restart worker after adding `.env` vars |
| `Provisioner POST /tenants/.../suspend → ECONNREFUSED` | Provisioner not running but tenants exist | Start provisioner (§6.1); cron will recover on next tick |
| `Provisioner ... → 401: Unauthorized` | Worker and provisioner have different secrets | Re-check `PROVISIONER_SECRET` is identical in both env |

When the provisioner is unavailable, the cron loses that tick but `try/catch` inside `tick()` prevents the loop from dying. It'll try again next interval.

### Trial banner shows wrong state

Client-side calc: `daysLeft = ceil((trial_ends_at - now()) / 86400000)`.
- If banner shows "Trial expires in -X days" or similar: `trial_ends_at` is in the past but status is still `active` → tenant-trial cron hasn't run yet, or isn't running. Check worker logs.
- If banner is absent when it should show: check `tenant.status` — banner only renders when status is `suspended` or `daysLeft ≤ 3`.

Fix expired-but-not-suspended tenants manually:
```sql
UPDATE tenants SET status = 'suspended', suspended_at = now()
WHERE status = 'active' AND trial_ends_at < now();
```
Then call provisioner suspend explicitly:
```bash
curl -X POST -H "x-provisioner-secret: $PROVISIONER_SECRET" \
  http://localhost:3850/tenants/{slug}/suspend
```

---

## 8. Recovery procedures

### Tenant container stuck

```bash
# Check state
docker ps --filter "label=secondlayer.slug={slug}" \
  --format "table {{.Names}}\t{{.Status}}\t{{.Label \"secondlayer.role\"}}"
```

**Note**: the provisioner doesn't manage in-place restarts. To recover a single crashed container, you can either:

1. Restart with Docker directly (keeps Docker's restart policy happy):
   ```bash
   docker restart sl-api-{slug}
   ```
2. Or call resize with the same plan — rebuilds everything from scratch:
   ```bash
   curl -X POST -H "x-provisioner-secret: $PROVISIONER_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"newPlan":"launch"}' \
     http://localhost:3850/tenants/{slug}/resize
   ```
   This brings brief downtime (~30s) but gives you fresh containers.

### Lost tenant credentials

The user lost their service key and needs a new one. No regeneration endpoint yet — workaround:

```sql
-- Find the tenant
SELECT slug, account_id, status, api_url_public
FROM tenants WHERE slug = '<slug>';
```

Decrypt with a small script on the app server (Bun):

```typescript
// save as /tmp/decrypt-creds.ts
import { getDb } from "@secondlayer/shared/db";
import { getTenantCredentials } from "@secondlayer/shared/db/queries/tenants";

const slug = process.argv[2];
const creds = await getTenantCredentials(getDb(), slug);
console.log(JSON.stringify(creds, null, 2));
process.exit(0);
```

Run:
```bash
docker exec secondlayer-api-1 bun run /tmp/decrypt-creds.ts <slug>
# Or: docker compose run --rm api bun run /tmp/decrypt-creds.ts <slug>
```

(Make sure `SECONDLAYER_SECRETS_KEY` is set in the container env — it is, for api/worker.)

To actually regenerate the keys (future work): mint a fresh `TENANT_JWT_SECRET`, overwrite the `_enc` columns, and update the running API container's env (or recreate it). Not implemented yet.

### Force-remove a tenant completely

The normal API flow (`DELETE /api/tenants/me`) does a **soft** teardown — stops containers, keeps volume, status → `suspended`. To hard-delete including the volume:

```bash
# As the tenant's own account (requires that account's session):
curl -X DELETE -H "Authorization: Bearer <session-token>" \
  https://api.secondlayer.tools/api/tenants/me
# Then wait 30d for purgeOldSuspended cron, OR manually:
curl -X DELETE -H "x-provisioner-secret: $PROVISIONER_SECRET" \
  "http://localhost:3850/tenants/{slug}?deleteVolume=true"
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "UPDATE tenants SET status = 'deleted' WHERE slug = '<slug>';"
```

No admin override endpoint exists. If you need to delete as an operator without the tenant's account, do the two-step (provisioner `DELETE` + SQL `UPDATE`) directly.

### Provisioner readonly role password rotated

Scenario: you changed `PROVISIONER_SOURCE_DB_READONLY_PASSWORD` in `.env` and restarted the provisioner. The provisioner re-bootstraps the role (`ALTER ROLE ... WITH PASSWORD`), so from the source DB's perspective the new password is live.

**But**: existing tenant API + processor containers still hold the OLD URL (with old password) in their env from when they were provisioned. They'll start failing with `password authentication failed` on next source-DB query.

Two options:

1. **Best**: resize every tenant (which rebuilds the containers with the new `buildSourceReadonlyUrl()`):
   ```bash
   for slug in $(docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -Atc "SELECT slug FROM tenants WHERE status='active'"); do
     curl -X POST -H "x-provisioner-secret: $PROVISIONER_SECRET" \
       -H "Content-Type: application/json" \
       -d "{\"newPlan\":\"$(docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -Atc "SELECT plan FROM tenants WHERE slug='$slug'")\"}" \
       "http://localhost:3850/tenants/$slug/resize"
   done
   ```
2. **Quick**: restore the old password (on the source DB), verify tenants healthy, then plan a proper rotation.

To avoid this, treat the readonly password as stable. Rotation is a **tenant-wide downtime event**.

### Source DB down / failing over

Source DB outage means tenant processors can't read blocks — but tenant API containers keep serving (they only read from target DB for most requests, except `/api/node/*`). Once source DB recovers, processors auto-reconnect via postgres.js built-in reconnection; no intervention needed.

---

## 9. Code map

| Concern | File(s) |
|---|---|
| Instance mode flag | `packages/shared/src/mode.ts` |
| Dual-DB getters | `packages/shared/src/db/index.ts` |
| Tenants table schema | `packages/shared/migrations/0039_tenants.ts` |
| Nullable api_key_id for oss/dedicated | `packages/shared/migrations/0037_nullable_api_key.ts` |
| Workflow table drop (setup for tenant model) | `packages/shared/migrations/0038_drop_workflow_tables.ts` |
| Tenant query helpers | `packages/shared/src/db/queries/tenants.ts` |
| Encryption envelope | `packages/shared/src/crypto/secrets.ts` |
| Auth factories | `packages/api/src/middleware/auth-modes.ts` |
| Mode-gated route mounting | `packages/api/src/index.ts` |
| Tenant lifecycle routes | `packages/api/src/routes/tenants.ts` |
| Platform-to-provisioner HTTP client | `packages/api/src/lib/provisioner-client.ts` |
| Worker-to-provisioner HTTP client | `packages/worker/src/jobs/provisioner-rpc.ts` |
| Trial expiry cron | `packages/worker/src/jobs/tenant-trial.ts` |
| Health + storage cron | `packages/worker/src/jobs/tenant-health.ts` |
| Provisioner config | `packages/provisioner/src/config.ts` |
| Compute plans + allocation | `packages/provisioner/src/plans.ts` |
| Slug + container naming | `packages/provisioner/src/names.ts` |
| Public types | `packages/provisioner/src/types.ts` |
| Docker Engine API client | `packages/provisioner/src/docker.ts` |
| Readonly role bootstrap | `packages/provisioner/src/readonly-role.ts` |
| Migrator container spawner | `packages/provisioner/src/migrations.ts` |
| JWT minting | `packages/provisioner/src/jwt.ts` |
| Provision orchestrator | `packages/provisioner/src/provision.ts` |
| Teardown | `packages/provisioner/src/teardown.ts` |
| Suspend/resume/resize/status | `packages/provisioner/src/lifecycle.ts` |
| Storage measurement | `packages/provisioner/src/storage.ts` |
| HTTP routes (Hono) | `packages/provisioner/src/routes.ts` |
| Provisioner entry point | `packages/provisioner/src/index.ts` |
| Base compose (provisioner defined here) | `docker/docker-compose.yml` |
| Hetzner prod overrides (current) | `docker/docker-compose.hetzner.yml` |
| Dedicated-hosting compose (not yet deployed) | `docker/docker-compose.dedicated.yml` |
| Traefik static config | `docker/traefik/traefik.yml` |
| Dockerfile (all targets incl. `provisioner`) | `docker/Dockerfile` |
| Deploy script | `docker/scripts/deploy.sh` |
| Instance dashboard page | `apps/web/src/app/platform/instance/page.tsx` |
| Instance dashboard client | `apps/web/src/app/platform/instance/instance-view.tsx` |
| Dashboard-side proxy routes | `apps/web/src/app/api/tenants/route.ts` + `me/route.ts` + `me/resize/route.ts` |
| `/instance` rewrite | `apps/web/src/middleware.ts` |
| CLI instance commands | `packages/cli/src/commands/instance.ts` |
| Operations runbook (env vars + prod runbook) | `docker/docs/OPERATIONS.md` |
| This doc | `docker/docs/DEDICATED_HOSTING.md` |

---

## 10. What's not yet done (Sprint 8 + beyond)

### 10.1 Migration script — **forthcoming** (Sprint 8, in progress)

The tool that migrates an existing single-DB subgraph data into a per-tenant DB. Rough plan (from `~/.claude/plans/lexical-toasting-shannon.md`):

Per account:
1. Provision a dedicated instance (reuse `provisionTenant`)
2. `pg_dump --schema="subgraph_{prefix}_{name}"` from the shared source DB
3. `pg_restore` to the tenant target DB
4. `ALTER SCHEMA "subgraph_{prefix}_{name}" RENAME TO "subgraph_{name}"` in tenant DB
5. Export `subgraph` + related rows filtered by `api_key_id`; import to tenant
6. Update `subgraphs.schema_name` to drop the prefix
7. Copy handler files to the tenant volume
8. Start tenant services (already started by provisioner step 1)

Compatibility proxy (Sprint 8.2): old API keys continue to work via platform-API lookup → proxy to tenant endpoint. 30-day overlap period.

Will be added to `packages/provisioner/src/migrate-tenant.ts`. This section of the doc will be filled in once that lands.

### 10.2 Shared-tenancy removal — **forthcoming** (Sprint 8.3)

After all users are migrated, remove the `platform` mode code paths. The master plan has a 15-point tenant-isolation checklist that needs executing:
- `keyPrefix` in `pgSchemaName`
- `api_key_id` filtering throughout queries
- Cache keys in `packages/api/src/subgraphs/cache.ts`
- `usage.ts` counting logic
- `enforceLimits` middleware

Will be tracked in a separate doc after Sprint 8.1 lands.

### 10.3 Billing integration — **post-MVP**

Stubbed out. Built with Stripe in mind (plan IDs match a subscription product structure), no actual integration. No Stripe customer/subscription rows in `tenants` yet.

### 10.4 Formal alerting — **post-MVP**

Current state:
- Storage > 80% → `logger.warn` (shows up in worker logs, nothing else)
- Container unhealthy → `logger.error` + `setTenantStatus('error')`
- Trial expiring → banner on dashboard only

Missing:
- Slack notification when a tenant hits status=error
- Email to account owner on trial expiry warning (7d/3d/1d)
- PagerDuty/Sentry hook for provision failures

The platform agent container (`packages/agent`) has working Slack wiring — extending it to consume tenant-specific events is the natural path.

### 10.5 Regenerate service key flow

Currently `ConnectionSnippets` says "Regenerate at any time" but the endpoint doesn't exist. Needs:
- `POST /api/tenants/me/regenerate-keys` — mints new JWT secret + keys, updates encrypted columns, hot-reloads the running API container's `TENANT_JWT_SECRET` env (or triggers a silent container recreate).

### 10.6 Multi-server scaling

Everything here assumes a single host running the provisioner + all tenant containers. When the host is full:
- Provisioner needs to know about multiple Docker hosts (swap unix socket for TCP)
- DNS needs to route per-tenant (currently single A record wildcard)
- Cross-host tenant migration (move volume + containers)

Out of scope for now — a single Hetzner AX52 fits a lot of Launch tenants.

### 10.7 Per-tenant backups

`pg_dump` daily per tenant DB on cron. Still TODO — base backup script at `/opt/secondlayer/docker/scripts/backup-postgres.sh` handles the shared DB only.

---

## Appendix A — Useful state-check SQL

```sql
-- All tenants, most recent first
SELECT slug, plan, status, trial_ends_at, storage_used_mb, storage_limit_mb,
       last_health_check_at, suspended_at, created_at
FROM tenants
ORDER BY created_at DESC;

-- Tenants approaching storage limit (>80%)
SELECT slug, storage_used_mb, storage_limit_mb,
       ROUND((storage_used_mb::numeric / storage_limit_mb) * 100, 1) AS pct
FROM tenants
WHERE status = 'active' AND storage_limit_mb > 0
  AND storage_used_mb > (storage_limit_mb * 0.8);

-- Expired trials still marked active (cron hasn't run, or is broken)
SELECT slug, trial_ends_at, now() - trial_ends_at AS overdue
FROM tenants
WHERE status IN ('provisioning', 'active') AND trial_ends_at < now();

-- Long-suspended tenants past retention (should be purged)
SELECT slug, suspended_at, now() - suspended_at AS suspended_for
FROM tenants
WHERE status = 'suspended' AND suspended_at < now() - interval '30 days';

-- Mismatch between recorded plan and storage_limit
SELECT slug, plan, memory_mb, cpus, storage_limit_mb
FROM tenants
WHERE (plan = 'launch'     AND (memory_mb <> 2048  OR storage_limit_mb <> 10240))
   OR (plan = 'grow'       AND (memory_mb <> 4096  OR storage_limit_mb <> 51200))
   OR (plan = 'scale'      AND (memory_mb <> 8192  OR storage_limit_mb <> 204800))
   OR (plan = 'enterprise' AND (memory_mb <> 32768 OR storage_limit_mb <> -1));

-- Tenant containers visible via Docker labels
-- (run from shell, not SQL)
-- docker ps --filter "label=secondlayer.slug" \
--   --format "table {{.Names}}\t{{.Status}}\t{{.Label \"secondlayer.slug\"}}\t{{.Label \"secondlayer.role\"}}\t{{.Label \"secondlayer.plan\"}}"
```

## Appendix B — Provisioner HTTP reference

All requests require `X-Provisioner-Secret: $PROVISIONER_SECRET`. All JSON bodies require `Content-Type: application/json`.

```bash
BASE=http://localhost:3850
SECRET=$PROVISIONER_SECRET

# Liveness (no secret required)
curl $BASE/health

# Provision
curl -X POST -H "x-provisioner-secret: $SECRET" -H "content-type: application/json" \
  -d '{"accountId":"<uuid>","plan":"launch"}' \
  $BASE/tenants
# Returns TenantResources JSON.

# Status
curl -H "x-provisioner-secret: $SECRET" \
  "$BASE/tenants/{slug}?plan=launch"

# Storage (caller passes tenant DB URL — provisioner is stateless)
curl -H "x-provisioner-secret: $SECRET" \
  "$BASE/tenants/{slug}/storage?url=postgres://secondlayer:<pw>@sl-pg-{slug}:5432/secondlayer"

# Suspend / resume
curl -X POST -H "x-provisioner-secret: $SECRET" $BASE/tenants/{slug}/suspend
curl -X POST -H "x-provisioner-secret: $SECRET" $BASE/tenants/{slug}/resume

# Resize
curl -X POST -H "x-provisioner-secret: $SECRET" -H "content-type: application/json" \
  -d '{"newPlan":"grow"}' \
  $BASE/tenants/{slug}/resize

# Teardown (soft — keeps volume)
curl -X DELETE -H "x-provisioner-secret: $SECRET" \
  "$BASE/tenants/{slug}?deleteVolume=false"

# Teardown (hard — removes volume)
curl -X DELETE -H "x-provisioner-secret: $SECRET" \
  "$BASE/tenants/{slug}?deleteVolume=true"
```
