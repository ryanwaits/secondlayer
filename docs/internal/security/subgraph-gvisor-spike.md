# Spike: tenant stack isolation on gVisor (containment suite)

Earlier approach (in-process worker sandbox, not pursued): [subgraph-processor-sandbox-spike.md](./subgraph-processor-sandbox-spike.md).

- **Run**: 2026-10-05, throwaway Hetzner `ccx13` (2 dedicated vCPU AMD EPYC-Milan, 8 GB, fsn1), Ubuntu 24.04, booted from the real `render-cloud-init.sh` output. Image `ghcr.io/ryanwaits/secondlayer-api:554c9a82` (Bun 1.4.2). gVisor `release-20260928.0`, platform **systrap** (runsc default, no flag). Docker 29.x.
- **Reproduce**: `spike/045-containment/run.sh` (creates and deletes its own `spike-045-<epoch>` key, firewall, server). Raw output: `spike/045-containment/results/`.
- **Shape tested**: two tenant projects from `docker/workload/tenant.compose.yml` plus `spike/045-containment/tenant.hardening.yml`. Stack A runs the probe subgraph (dummy hosted key, holds no real credential). Stack B runs a benign pox-5 + stx_transfer fixture against hosted Index. Stack C is the same fixture under `runc`, for comparison only.

## Verdict: NO-GO as specified

Every containment boundary held. The shape does not work as specified, for three reasons that each need a decision before plan 046:

1. `res:pids` fails: `pids_limit: 128` stops a fork bomb at **48** children under runsc (ENOMEM), not near 128.
2. Docker's embedded DNS does not work under runsc: every lookup times out (service names and public names). The tenant file as written cannot start a working stack; the suite ran only after a workaround (below).
3. The webhook-service meter socket (host unix socket) is unreachable from a runsc container: `ECONNREFUSED`, even with correct ownership. runsc's `host-uds` is `none`.

Per the plan, an outcome different from the expected one is a NO-GO. Rules were not tuned.

## Suite results

Each check ran twice from the same module: once in the api's deploy-time probe (`deploy-probe`), once in the processor at startup (`processor`). All 15 lines matched in both paths. The handler-level call never fired (no block ever matched in stack A, which has no chain data); it is untested.

| check | expected | outcome (both paths) | detail |
|---|---|---|---|
| env:pid1 | own keys only | own-only | key names only; api holds INSTANCE_TOKEN, processor does not |
| fs:docker-sock | false | false | |
| fs:mounts | declared only | declared-only | plus the three Docker-managed files `/etc/hosts`, `/etc/hostname`, `/etc/resolv.conf` (treated as allowed) |
| fs:write-root | blocked | blocked | EACCES as uid 1000; root mount shows `ro` |
| tcp:own-postgres | reachable | reachable | via `extra_hosts` (see DNS) |
| tcp:other-tenant-postgres | blocked | blocked | 172.30.2.10:5432, ETIMEDOUT |
| dns:other-tenant | not-found | not-found | only after the resolver workaround; stock runsc gives a timeout |
| tcp:other-tenant-api | blocked | blocked | gateway 172.30.1.1:3922 |
| tcp:host-gateway | blocked | blocked | gateway :8080 |
| tcp:control-pg | blocked | blocked | gateway :5432 |
| tcp:metadata | blocked | blocked | 169.254.169.254:80 |
| tcp:rfc1918 (10.0.0.2, 172.16.0.1, 192.168.0.1 :443) | blocked | blocked x3 | |
| tcp:public-api | reachable | reachable | |
| res:pids | stops near 128 | **stopped at 48 (ENOMEM)** | FAIL. Stack B kept running |
| res:memory | OOM-killed near 512 MB | OOM-killed, 448 MB held | docker oom event seen; B unaffected |
| res:cpu | B keeps advancing | A at 100.9% (1 cpu cap); B advanced 8 blocks in ~65 s | |

"Blocked" means the firewall, not nothing listening: accept-and-close listeners were started on the host at gateway :8080, :5432 and :3922 (host-side connect succeeded). A positive control from a runsc container on A's network: `blocked` as provisioned, `reachable` once an ACCEPT rule for :8080 was inserted ahead of `WORKLOAD-INPUT`. Rule packet counters after the suite show hits on the metadata, RFC1918 and `WORKLOAD-INPUT` DROP rules.

Notes:
- `tcp:other-tenant-postgres` and the other drops rely on DROP (timeout), not REJECT. A refused connection would count as reached; none occurred.
- `res:pids`: limit applies to the sandbox's host threads, so it does not map to child process count. 48 is also well under 128, so the limit is protective but not "near 128". Needs a decision on what the number means, not a fix to the isolation.

## Hardening: what fails under `user: 1000` / `read_only` and the fix

Tested on the real stack. Without the fixes below, the only startup failures were the two ownership problems. Everything else started and passed health checks.

| item | failure | fix |
|---|---|---|
| `subgraphs_data` named volume | created root-owned (image has no `/data/subgraphs`); uid 1000 gets `Permission denied` writing handler files, so every deploy fails | one-shot `volume-init` service (root, default runtime) chowns `/data` to 1000:1000; api and processor `depends_on` it. In `tenant.hardening.yml` |
| meter socket dir | provisioner makes it root-owned 0700; uid 1000 in webhook-service gets `EACCES` | dir and socket must be owned by or open to uid 1000 (or a shared group). Provisioner change, `packages/workload`, not made here |
| `/tmp` | not a failure: runsc leaves `/tmp` writable even with `--read-only` and no tmpfs (in-sandbox memory), `/` and `/app` stay read-only. Keep `tmpfs: [/tmp]` so behavior matches runc | none |
| `api`, `webhook-service`, `subgraph-processor`, `postgres`, `migrate` | no other startup failures as uid 1000 / read-only root / no-new-privileges under runsc | |

## runsc-specific findings

- **Docker embedded DNS fails.** `nameserver 127.0.0.11` is unreachable from the sandbox's own network stack. Under runc the same lookups work. Evidence: `results/1a-experiments.txt` (E4). Workaround used and tested: bind-mount a `resolv.conf` with a public resolver (`spike/045-containment/resolv.conf`, `nameserver 1.1.1.1`) and give postgres a static address plus `extra_hosts: postgres:<ip>`, with a unique /24 per tenant (`TENANT_SUBNET`, `TENANT_PG_IP`). Cost: a per-tenant subnet allocator in the provisioner, and tenants depend on an external resolver (public UDP 53 is allowed by `docker-user-egress.sh`).
- **Host unix sockets unreachable.** `webhook-service` talks to the provisioner's meter over a unix socket bind mount. From runsc: `ECONNREFUSED` even as root; from runc as root the same mount connects. The sandbox runs with `host-uds: none`. Options: `--host-uds=open` on runsc (weakens the boundary), or move the meter to a loopback/bridge TCP listener with the existing firewall rules adjusted.
- **cloud-init runsc path** was wrong (`/usr/local/bin/runsc`; the package installs `/usr/bin/runsc`). Fixed in `docker/workload-host/cloud-init.yaml` as its own commit; this run used the fixed config with no workaround and runsc started containers.
- **Bun runs under runsc** (default platform systrap; no kvm needed): 256 MB alloc, 5M-iteration loop, child spawn all fine.

## Latency (same fixture, same 400-block range, warm = first 20 blocks dropped, ~375 blocks)

Per-block `totalMs` as logged by the processor (a preload patches the stats accumulator; whole-ms resolution, so p50 has +-0.5 ms uncertainty):

| runtime | p50 | p95 | mean | max |
|---|---|---|---|---|
| runc | 2 ms | 5.0 ms | 2.67 ms | 29 ms |
| runsc | 4 ms | 10.4 ms | 5.15 ms | 45 ms |

Ratio p50 2.0x (< the 3x stop line). In absolute terms a few ms per block on a ~5-10 s block cadence. The handler cost itself is ~0 ms in both; the difference is the DB transaction flush path (flush p50 1 ms vs 0 ms).

## Memory at idle (docker stats, MiB; whole stack incl. postgres)

| stack | runtime | api | processor | webhook-service | postgres | total |
|---|---|---|---|---|---|---|
| B | runsc | 122 | 68 | 48 | 69 | ~308 |
| C | runc | 100 | 45 | 30 | 69 | ~244 |
| A (probe) | runsc | 130 | 47 | 46 | 59 | ~282 |

runsc adds roughly 20-25 MiB per service (sentry). About +60 MiB per tenant stack, on an 8 GB host: tens of tenants, not hundreds, before postgres dominates.

## Open items before 046

1. Decide the pids semantics (what `pids_limit` should be, or measure with a different limit and re-run `res:pids`).
2. Adopt the DNS workaround (static postgres address + resolver mount) or find a runsc network mode that keeps Docker DNS.
3. Replace the unix-socket meter, or accept `--host-uds` and its trade-off.
4. Provisioner: create the socket dir for uid 1000 (if the socket stays).
5. Handler-level call under a real block was not exercised.
