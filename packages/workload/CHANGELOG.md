# @secondlayer/workload

## 0.2.17

### Patch Changes

- Updated dependencies [d990835]
- Updated dependencies [47f4aa7]
  - @secondlayer/shared@14.0.0
  - @secondlayer/platform@0.9.5

## 0.2.16

### Patch Changes

- Updated dependencies [c2c008e]
  - @secondlayer/shared@13.14.0
  - @secondlayer/platform@0.9.4

## 0.2.15

### Patch Changes

- Updated dependencies [f3d0262]
  - @secondlayer/shared@13.13.1
  - @secondlayer/platform@0.9.3

## 0.2.14

### Patch Changes

- Updated dependencies [3c50af1]
  - @secondlayer/platform@0.9.2

## 0.2.13

### Patch Changes

- Updated dependencies
- Updated dependencies [893a076]
- Updated dependencies [e5db74b]
- Updated dependencies [4485f94]
  - @secondlayer/shared@13.13.0
  - @secondlayer/platform@0.9.1

## 0.2.12

### Patch Changes

- Updated dependencies [ee067e0]
  - @secondlayer/shared@13.12.0
  - @secondlayer/platform@0.9.0

## 0.2.11

### Patch Changes

- Updated dependencies [357e7e1]
  - @secondlayer/shared@13.11.0
  - @secondlayer/platform@0.8.11

## 0.2.10

### Patch Changes

- Updated dependencies
  - @secondlayer/shared@13.10.0
  - @secondlayer/platform@0.8.10

## 0.2.9

### Patch Changes

- Updated dependencies
  - @secondlayer/shared@13.9.0
  - @secondlayer/platform@0.8.9

## 0.2.8

### Patch Changes

- Updated dependencies [7c0e359]
  - @secondlayer/shared@13.8.0
  - @secondlayer/platform@0.8.8

## 0.2.7

### Patch Changes

- Updated dependencies
  - @secondlayer/shared@13.7.1
  - @secondlayer/platform@0.8.7

## 0.2.6

### Patch Changes

- Updated dependencies
  - @secondlayer/shared@13.7.0
  - @secondlayer/platform@0.8.6

## 0.2.5

### Patch Changes

- Updated dependencies [13958c2]
  - @secondlayer/shared@13.6.0
  - @secondlayer/platform@0.8.5

## 0.2.4

### Patch Changes

- Updated dependencies [ee9a561]
  - @secondlayer/shared@13.5.0
  - @secondlayer/platform@0.8.4

## 0.2.3

### Patch Changes

- Updated dependencies [61466da]
  - @secondlayer/shared@13.4.0
  - @secondlayer/platform@0.8.3

## 0.2.2

### Patch Changes

- Updated dependencies [3dfd4cd]
- Updated dependencies [cc11e97]
- Updated dependencies [a12314b]
  - @secondlayer/shared@13.3.0
  - @secondlayer/platform@0.8.2

## 0.2.1

### Patch Changes

- Updated dependencies
  - @secondlayer/shared@13.2.1
  - @secondlayer/platform@0.8.1

## 0.2.0

### Minor Changes

- e48692c: A webhook-only hosted stack no longer runs `subgraph-processor` (compose profile `subgraphs`, reconciled each tick and right after a deploy from the tenant's own subgraph count into `tenants.has_subgraphs`) and bills a $5/mo memory floor; a stack with subgraphs bills $10/mo. Floors are set in dollars (`STACK_FLOOR_USD_MICROS_PER_MONTH`) and the GB floor is derived from the memory rate. Tenant Postgres drops to `shared_buffers=16MB`.

### Patch Changes

- Updated dependencies [b2e391f]
- Updated dependencies [e33e2a3]
- Updated dependencies [e48692c]
  - @secondlayer/shared@13.2.0
  - @secondlayer/platform@0.8.0

## 0.1.0

### Minor Changes

- b81888c: A hosted stack with no active webhooks and no subgraphs stops on its own (5-minute poll, never within 15 minutes of starting, never on an unreadable count) and starts again on its next request. Stopped tenants record why (`credits`, `cap` or `idle`); the poll restarts only credit and cap stops once the account is ok.
- c97cbe8: Nightly `pg_dump -Fc` of every running or stopped tenant to an S3-compatible bucket (`TENANT_BACKUP_*` env, Bun's `S3Client`), last 7 kept. Tenant destroy takes a final dump first (kept 30 days) and refuses to run without a bucket or when the dump fails. Tenant postgres is capped at 192 MB (`shared_buffers=32MB`, `max_connections=30`), webhook-service at 256 MB, and every tenant process uses a pool of 5 connections.

### Patch Changes

- Updated dependencies [1b8999a]
- Updated dependencies [80595ce]
- Updated dependencies [6df9804]
  - @secondlayer/shared@13.1.0
  - @secondlayer/platform@0.7.0

## 0.0.46

### Patch Changes

- Updated dependencies [535cfbd]
- Updated dependencies [ee66b19]
  - @secondlayer/shared@13.0.0
  - @secondlayer/platform@0.6.9

## 0.0.45

### Patch Changes

- Updated dependencies
  - @secondlayer/shared@12.1.2
  - @secondlayer/platform@0.6.8

## 0.0.44

### Patch Changes

- Updated dependencies [f617184]
- Updated dependencies [eb522f5]
  - @secondlayer/shared@12.1.1
  - @secondlayer/platform@0.6.7

## 0.0.43

### Patch Changes

- Updated dependencies [68a6e44]
  - @secondlayer/shared@12.1.0
  - @secondlayer/platform@0.6.6

## 0.0.42

### Patch Changes

- Updated dependencies [fe0bdd7]
  - @secondlayer/shared@12.0.0
  - @secondlayer/platform@0.6.5

## 0.0.41

### Patch Changes

- Updated dependencies [61e6a8d]
  - @secondlayer/shared@11.24.1
  - @secondlayer/platform@0.6.4

## 0.0.40

### Patch Changes

- Updated dependencies [3553ac4]
  - @secondlayer/shared@11.24.0
  - @secondlayer/platform@0.6.3

## 0.0.39

### Patch Changes

- Updated dependencies [49ab850]
  - @secondlayer/shared@11.23.0
  - @secondlayer/platform@0.6.2

## 0.0.38

### Patch Changes

- Updated dependencies [6ddce56]
  - @secondlayer/shared@11.22.0
  - @secondlayer/platform@0.6.1

## 0.0.37

### Patch Changes

- b5488e8: Hosted subgraph and webhook errors now carry the same envelope as the platform API: the gateway forwards one `X-Request-Id` end to end, adds `request_id`, `code` and `feedback.url` to JSON errors, and ships failed-request records to app-server (`POST /internal/failed-requests`) for feedback evidence.
- Updated dependencies [0c3ccff]
- Updated dependencies [4394a96]
- Updated dependencies [d606f80]
- Updated dependencies [6427bc2]
  - @secondlayer/shared@11.21.0
  - @secondlayer/platform@0.6.0

## 0.0.36

### Patch Changes

- Updated dependencies [00b955a]
- Updated dependencies [b57387b]
- Updated dependencies [f8cb9ee]
  - @secondlayer/shared@11.20.0
  - @secondlayer/platform@0.5.6

## 0.0.35

### Patch Changes

- Updated dependencies [0ca7fb4]
- Updated dependencies [1308f51]
  - @secondlayer/shared@11.19.3
  - @secondlayer/platform@0.5.5

## 0.0.34

### Patch Changes

- 8cc8dac: A hosted stack now counts every processor death, including one during a reindex, halts a subgraph that keeps killing it and cancels its operations, rolls tenants when the compose template changes, and answers a subgraph delete in seconds even when the reindex runner died.
- Updated dependencies [8cc8dac]
  - @secondlayer/shared@11.19.2
  - @secondlayer/platform@0.5.4

## 0.0.33

### Patch Changes

- e93f016: Hosted stacks now run a subgraph processor under gVisor with a metered read key, route subgraph requests through the gateway, refuse sources a stack can't feed, and restart a processor that stalls or runs out of memory.

## 0.0.32

### Patch Changes

- ab41c92: The workload host now follows deploys on its own and clears provisions a restart interrupted, so stacks no longer get stuck at "provisioning".
- Updated dependencies [da05bec]
  - @secondlayer/shared@11.19.1
  - @secondlayer/platform@0.5.3

## 0.0.31

### Patch Changes

- Updated dependencies [b1c7ff6]
  - @secondlayer/shared@11.19.0
  - @secondlayer/platform@0.5.2

## 0.0.30

### Patch Changes

- Updated dependencies [3f7945c]
  - @secondlayer/shared@11.18.0
  - @secondlayer/platform@0.5.1

## 0.0.29

### Patch Changes

- Updated dependencies [c7ef442]
- Updated dependencies [c24af9d]
- Updated dependencies [326fa4f]
  - @secondlayer/platform@0.5.0
  - @secondlayer/shared@11.17.0

## 0.0.28

### Patch Changes

- Updated dependencies [50b453e]
  - @secondlayer/shared@11.16.1
  - @secondlayer/platform@0.4.1

## 0.0.27

### Patch Changes

- Updated dependencies [45534c7]
- Updated dependencies [e7231e5]
  - @secondlayer/platform@0.4.0
  - @secondlayer/shared@11.16.0

## 0.0.26

### Patch Changes

- fb93859: The memory meter now reports the raw sampled RAM alongside the floored, billed quantity, so the credits page can show actual usage against the 0.5 GB minimum.
- Updated dependencies [bdbb446]
- Updated dependencies [b785dd2]
- Updated dependencies [fb93859]
- Updated dependencies [b785dd2]
- Updated dependencies [fb93859]
  - @secondlayer/platform@0.3.25
  - @secondlayer/shared@11.15.3

## 0.0.25

### Patch Changes

- 1de3077: Bill a running hosted stack's memory at a minimum of 0.5 GB (about $10/mo while running); a stopped stack still bills nothing.
- Updated dependencies [1de3077]
  - @secondlayer/platform@0.3.24

## 0.0.24

### Patch Changes

- Updated dependencies [e6ba2b4]
  - @secondlayer/shared@11.15.2
  - @secondlayer/platform@0.3.23

## 0.0.23

### Patch Changes

- Updated dependencies [1643f22]
- Updated dependencies [0ed732d]
  - @secondlayer/shared@11.15.1
  - @secondlayer/platform@0.3.22

## 0.0.22

### Patch Changes

- Updated dependencies [61c1cb6]
- Updated dependencies [2bfbad9]
- Updated dependencies [5320eb2]
  - @secondlayer/shared@11.15.0
  - @secondlayer/platform@0.3.21

## 0.0.21

### Patch Changes

- Updated dependencies [dd4ab6a]
  - @secondlayer/shared@11.14.3
  - @secondlayer/platform@0.3.20

## 0.0.20

### Patch Changes

- Updated dependencies [7771458]
  - @secondlayer/shared@11.14.2
  - @secondlayer/platform@0.3.19

## 0.0.19

### Patch Changes

- Updated dependencies [7491186]
  - @secondlayer/shared@11.14.1
  - @secondlayer/platform@0.3.18

## 0.0.18

### Patch Changes

- Updated dependencies [955130c]
  - @secondlayer/shared@11.14.0
  - @secondlayer/platform@0.3.17

## 0.0.17

### Patch Changes

- Updated dependencies [eebec6e]
  - @secondlayer/shared@11.13.2
  - @secondlayer/platform@0.3.16

## 0.0.16

### Patch Changes

- Updated dependencies [b886f88]
  - @secondlayer/shared@11.13.1
  - @secondlayer/platform@0.3.15

## 0.0.15

### Patch Changes

- Updated dependencies [1b2b5f4]
- Updated dependencies [b83d2b0]
  - @secondlayer/shared@11.13.0
  - @secondlayer/platform@0.3.14

## 0.0.14

### Patch Changes

- Updated dependencies [5898759]
  - @secondlayer/shared@11.12.5
  - @secondlayer/platform@0.3.13

## 0.0.13

### Patch Changes

- Updated dependencies [507504b]
  - @secondlayer/shared@11.12.4
  - @secondlayer/platform@0.3.12

## 0.0.12

### Patch Changes

- 32355cd: `shutdown()` used to clear the meter timers and `process.exit(0)` straight away, dropping up to an hour of accumulated `memory.gb_hour` plus anything sitting in a pending retry buffer on every restart or deploy. It now runs one final flush of every meter's live accumulator and pending buffer (same idempotency keys, so a re-send is safe), bounded by a 5s timeout, and ignores a second SIGINT/SIGTERM while that flush is in flight.
- Updated dependencies [134b5cc]
- Updated dependencies [df5090b]
  - @secondlayer/shared@11.12.3
  - @secondlayer/platform@0.3.11

## 0.0.11

### Patch Changes

- Updated dependencies [d5820d7]
  - @secondlayer/shared@11.12.2
  - @secondlayer/platform@0.3.10

## 0.0.10

### Patch Changes

- Updated dependencies [e9f4d1c]
  - @secondlayer/shared@11.12.1
  - @secondlayer/platform@0.3.9

## 0.0.9

### Patch Changes

- Updated dependencies [8152489]
  - @secondlayer/shared@11.12.0
  - @secondlayer/platform@0.3.8

## 0.0.8

### Patch Changes

- Updated dependencies [3c406a1]
  - @secondlayer/shared@11.11.2
  - @secondlayer/platform@0.3.7

## 0.0.7

### Patch Changes

- Updated dependencies [0b4efbe]
  - @secondlayer/shared@11.11.1
  - @secondlayer/platform@0.3.6

## 0.0.6

### Patch Changes

- Updated dependencies [201d1fc]
  - @secondlayer/shared@11.11.0
  - @secondlayer/platform@0.3.5

## 0.0.5

### Patch Changes

- 78bf3bf: Tenant stacks now follow every prod deploy automatically. The host polls app-server's `/health` for the deployed image sha every 5 minutes and rolls stale `running` tenants forward one at a time (pull, then up, recording what each tenant runs); a failed pull or a failed health-check on the new containers stops the round and rolls that tenant back to its previous sha. `WORKLOAD_IMAGE_TAG` is no longer a required env var on the workload host — the provisioner resolves and supplies it per compose call instead.

## 0.0.4

### Patch Changes

- Updated dependencies [fd87555]
  - @secondlayer/shared@11.10.1
  - @secondlayer/platform@0.3.4

## 0.0.3

### Patch Changes

- Updated dependencies [4fdf331]
  - @secondlayer/shared@11.10.0
  - @secondlayer/platform@0.3.3

## 0.0.2

### Patch Changes

- Updated dependencies [9fdc2be]
  - @secondlayer/shared@11.9.1
  - @secondlayer/platform@0.3.2

## 0.0.1

### Patch Changes

- Updated dependencies [9fe75e7]
  - @secondlayer/shared@11.9.0
  - @secondlayer/platform@0.3.1
