# @secondlayer/workload

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
