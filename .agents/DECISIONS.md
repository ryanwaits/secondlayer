# Decisions

Append-only ADR log.

## ADR-0001: L2 stores decoded events
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #25
**Context:** Stacks Index needed a public L2 storage contract for decoded transfer data.
**Decision:** L2 is decoded events, not transactions. Use one shared `decoded_events` table typed by `event_type`.
**Consequences:** Public Index endpoints read typed views over shared L2 rows. Transaction tables stay internal.

## ADR-0002: Public decoded columns use stable strings
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #25
**Context:** Decoded transfer fields needed durable public shapes.
**Decision:** `contract_id` is the full principal string, with no split. `amount` is `TEXT` in the database and a string in JSON.
**Consequences:** Customers do not depend on local contract parsing or unsafe number coercion.

## ADR-0003: NFT values stay raw in v1
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #25
**Context:** NFT identifiers can be arbitrary Clarity values.
**Decision:** NFT `value` is the raw Clarity-serialized hex string in v1. Decoded JSON is deferred to v1.1.
**Consequences:** The v1 surface is stable and lossless. Client-side decoding can land later without changing storage.

## ADR-0004: L2 responses carry a reorg envelope
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #25
**Context:** Stacks Index needed to mirror the Streams response contract.
**Decision:** Every L2 response carries `reorgs: []`. It is always an array, never null. L2 itself does not emit envelope entries. Customers detect reorgs through `canonical=false` rows disappearing.
**Consequences:** SDK response handling stays shared across layers. L2 reorg signaling remains conservative.

## ADR-0005: Rate limits are per layer
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #28
**Context:** Stacks Streams and Stacks Index have different product value and load profiles.
**Decision:** Rate-limit buckets are per layer, not shared. Build gets 50 r/s on Stacks Streams and 50 r/s on Stacks Index separately.
**Consequences:** Customers can use both surfaces without one workload starving the other.

## ADR-0006: L2 reorg recovery rewinds and re-decodes
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #28
**Context:** The continuous decoder needed a deterministic recovery path.
**Decision:** L2 reorg handling marks rows `canonical=false`, rewinds the checkpoint, and re-decodes with `onConflict.doUpdateSet`.
**Consequences:** Recovery is idempotent. Replay can repair affected rows without a bespoke migration.

## ADR-0007: Lag is reported, not treated as outage
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #28
**Context:** Stacks Index may lag L1 while the decoder catches up.
**Decision:** Serve stale data with `tip.lag_seconds`. Return 503 only when L2 storage is unavailable.
**Consequences:** Customers see freshness in-band. Temporary lag does not become an API outage.

## ADR-0008: Decoder checkpoint table is reused
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #19
**Context:** The L2 decoder already had checkpoint infrastructure from Streams dogfooding.
**Decision:** Reuse `l2_decoder_checkpoints`.
**Consequences:** Decoder restart and replay behavior stay in one checkpoint path.

## ADR-0009: Endpoint reads filter canonical rows
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #28
**Context:** Public Index reads must hide non-canonical rows after reorg handling.
**Decision:** Endpoint queries filter `canonical=true` in the `WHERE` clause.
**Consequences:** Public responses only expose canonical decoded events.

## ADR-0010: Default reads use the recent window
**Date:** 2026-05-03
**Status:** Accepted
**Source:** commit ccec87f
**Context:** Unbounded default event reads caused a timeout.
**Decision:** The default query window is `tip - STREAMS_BLOCKS_PER_DAY` when no cursor or `from_height` is provided. Explicit `from_height=0` bypasses the default.
**Consequences:** Default reads stay bounded. Full backfill remains explicit.

## ADR-0011: Hetzner Postgres uses larger shared memory
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #27
**Context:** Production Postgres needed more shared memory under Docker.
**Decision:** Set Postgres `shm_size` to `1gb` in `docker-compose.hetzner.yml`.
**Consequences:** Hetzner Postgres has enough shared memory for the current workload.

## ADR-0012: Deploy SSH timeout is twenty minutes
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #24
**Context:** Cold Docker builds exceeded the previous SSH action timeout.
**Decision:** Set deploy `command_timeout` to `20m`.
**Consequences:** Deploy can finish cold builds without the SSH action terminating early.

## ADR-0013: Deploy CI lints Docker scripts under nounset
**Date:** 2026-05-03
**Status:** Accepted
**Source:** PR #35
**Context:** Deploy scripts had failed under unset shell variables.
**Decision:** CI lints `docker/scripts/*.sh` with `bash -nu`.
**Consequences:** Shell nounset regressions fail before deploy execution.

## ADR-0014: Agent operating manual lives at repo root
**Date:** 2026-05-04
**Status:** Accepted
**Source:** TBD
**Context:** Sprint-zero needed a home for agent operating files.
**Decision:** `.agents/` lives at the repo root.
**Consequences:** Agent instructions are visible on first repo listing and stay separate from human-facing product docs.

## ADR-0015: Sprint 2 Week 2 decisions are fully back-filled
**Date:** 2026-05-04
**Status:** Accepted
**Source:** TBD
**Context:** The ADR log needed enough context for remaining Stacks Index tasks.
**Decision:** Back-fill all Sprint 2 Week 2 decisions, not only decisions referenced by pending tasks.
**Consequences:** Future tasks can reference one complete decision set.

## ADR-0016: Agent gatekeeper is a separate workflow
**Date:** 2026-05-04
**Status:** Accepted
**Source:** TBD
**Context:** Voice, naming, ADR, and smoke hooks needed CI coverage on main.
**Decision:** Add `.github/workflows/agent-gatekeeper.yml` instead of extending deploy CI.
**Consequences:** Deploy remains focused on shipping. The gatekeeper guards main independently.

## ADR-0017: Slash commands remain agent skills
**Date:** 2026-05-04
**Status:** Accepted
**Source:** TBD
**Context:** Sprint-zero needed to reference `/check` and `/done`.
**Decision:** `/check` and `/done` are existing agent skills. Do not script them in `package.json` or a Makefile.
**Consequences:** The harness references the skills by name. Skill behavior changes happen in the skills, not repo scripts.
