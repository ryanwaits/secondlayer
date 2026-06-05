# Kickoff — P1: Real-time Plane Scale & Correctness

> **First read `docs/sprints/kourier-kickoffs/_context.md` and `docs/audits/kourier-parity-audit.md` (§3.1, §3.2, §3.4, §3.6, §5 P1).**
>
> **Goal of this session:** diagnose the P1 findings against current source and produce + review a sprint plan that makes the real-time/push plane scalable, complete (updates/deletes, reorgs, replay, signing), and gives Streams a true real-time surface. Then implement.
>
> **Depends on P0:** the subscription/processor extraction + leader work and the streams-index coupling are easier once P0-2 (API replicas) lands. The signing work reuses the existing `STREAMS_SIGNING_PRIVATE_KEY`. Order within P1: do the paired isolation+leader items together (they don't yield scale-out apart), land the quick correctness mirrors (stacking reorgs), then the streams real-time/signing lanes.

---

## P1-1 — Extract the subscription delivery plane out of subgraph-processor  `[MEDIUM]` (paired)

**ids:** `emitter-evaluator-fused-in-processor` + `trigger-evaluator-no-leader-election` · status: known-open. **Plan these together** — extraction without leader election (or vice versa) doesn't yield safe scale-out.

**Problem.** `startEmitter`, `startTriggerEvaluator`, and `handleChainReorg` (via `startStreamsReorgPoll`) all run inside the single `subgraph-processor` process — realtime delivery shares an event loop, DB pool, and lifecycle with subgraph indexing (a CPU-hot/crash-looping subgraph or large replay stalls webhook delivery). Separately, the evaluator runs unconditionally per replica against one global boolean-PK cursor: N replicas = N redundant Index fetch+match every 5s (`advanceCursor`'s `FOR UPDATE` serializes only the cursor write). Correct via `dedup_key`, but N× waste + a de-facto one-replica cap that blocks scale-out.

**Evidence:**
- `packages/subgraphs/src/runtime/processor.ts:508,516-519,524` — all three concerns booted in `startSubgraphProcessor`; teardown 534-537 = one lifecycle. Sole entrypoint `packages/subgraphs/src/service.ts` (`SERVICE_NAME="subgraph-processor"`).
- Deployed single-instance: `docker/docker-compose.yml:264-270`, `docker/docker-compose.hetzner.yml:114`.
- `packages/subgraphs/src/runtime/trigger-evaluator-loop.ts` — `runEvaluatorOnce` getTip+loadBlockRange+evaluateBlock per tick (`POLL_MS` default 5000); `advanceCursor` (~50-66) FOR UPDATE on cursor write only.
- `packages/shared/migrations/0088_chain_subscriptions.ts:54-61` — `trigger_evaluator_state` single boolean-PK row.
- Emitter already horizontally safe: `emitter.ts:330/339` `FOR UPDATE SKIP LOCKED LIMIT 50`. Leader pattern to mirror: `packages/indexer/src/leader.ts` (`withLeaderLock`, `pg_try_advisory_lock` on a max:1 conn + heartbeat).

**Fix direction.** New `subscription-processor` service entrypoint running only `startEmitter` + `startTriggerEvaluator` (+ reorg) against the shared outbox, deployable/scalable separately (compose + hetzner + Dockerfile target — coordinate with P2 image split). Gate the evaluator tick with `pg_try_advisory_lock` leader election (reuse `leader.ts`) OR shard the cursor by subscription-id; keep emitter delivery as competing-consumer. **Two-deploy cutover mandatory** (add new service alongside processor → canary-verify → remove from processor) to avoid a window where neither emits — see G5b risks in `data-plane-gap-remediation.md`.

---

## P1-2 — Subgraph-processor catch-up has no leader election  `[MEDIUM]`

**id:** `subgraph-processor-no-leader` · status: known-open. Share the leader util with P1-1.

**Problem.** On NOTIFY/poll the processor runs `catchUpAll` for every active subgraph guarded only by an in-process `Set` — 2+ processors double-process every block (idempotent upserts keep it correct, but no throughput gain + wasted CPU/DB; unlike the indexer there's no advisory-lock gate, so no safe scale-out path).

**Evidence:** `packages/subgraphs/src/runtime/processor.ts:449-498` (catchUpAll on startup/NOTIFY/poll); `packages/subgraphs/src/runtime/catchup.ts:22` (`const catchingUp = new Set<string>()` — process-local only); contrast `packages/indexer/src/leader.ts`.

**Fix direction.** Advisory-lock the catch-up loop (single-writer, mirror `leader.ts`) OR shard subgraphs across instances by a hashed DB-claimed assignment so processors add throughput. Use the same leader util chosen in P1-1.

---

## P1-3 — `stacking` endpoint omits `reorgs[]`  `[MEDIUM]` (quick win)

**id:** `stacking-no-reorgs` · status: new. Same class as the shipped G-txreorg fix.

**Problem.** Every height-keyed Index LIST endpoint reports `reorgs[]` except stacking — same `block_height:tx_index` cursor + `canonical=true` filter, so identical reorg exposure, but a client tracking stacking actions gets no reconciliation signal when a reorg orphans a stacking tx.

**Evidence:** `packages/api/src/index/stacking.ts:58-64` (StackingResponse has no `reorgs`), `:288-324` (`getStackingResponse` never reads reorgs); `packages/api/src/routes/index.ts:465-485` (route passes no `readReorgs`). Siblings to mirror: `/contract-calls` + `/transactions` use `readChainReorgsForHeightRange` (routes/index.ts:337,427).

**Fix direction.** Add `reorgs[]` to `StackingResponse`; wire `readChainReorgsForHeightRange` height-granular reconciliation in `getStackingResponse` and pass `readReorgs` in the route, mirroring contract-calls (~317-327). Add a reorg test.

---

## P1-4 — Subgraph subscriptions emit on INSERT only  `[MEDIUM]`

**id:** `subgraph-updates-deletes-not-emitted` · status: known-open ("v1" deferral).

**Problem.** `emitSubscriptionOutbox` skips any write whose `op !== 'insert'` and hardcodes `event_type` to `.created`. A receiver tracking mutable subgraph rows (balances, statuses, positions) sees the row appear then goes silent on every transition — a real-time stream that omits state changes. DB store stays correct; the stream is incomplete.

**Evidence:** `packages/subgraphs/src/runtime/outbox-emit.ts:82-87` (`if (write.op !== "insert") continue;` + hardcoded `${name}.${table}.created`). FlushManifest already carries everything: `context.ts:17-24` (`FlushWrite` op insert|update|delete + full row + pk), `:374-392` (flush emits all three op kinds). The third event_type segment (verb) is free.

**Fix direction.** Emit `.updated`/`.deleted` envelopes from the update/delete flush ops. Verify no format/doc assumes `.created`-only.

---

## P1-5 — Non-default webhook formats carry no Secondlayer authenticity  `[MEDIUM]`

**id:** `non-default-formats-unsigned` · status: known-open.

**Problem.** Of 6 formats only `standard-webhooks` calls `sign()`. `raw` + `cloudevents` carry no SL signature and no platform token, so the receiver has no proof the payload came from Secondlayer (`trigger`/`cloudflare`/`inngest` are more defensible — platform tokens gate the call). Note: every format DOES embed the outbox id for dedup (in body), so the "no stable delivery-id" concern is partly mis-stated — the real gap is cryptographic authenticity.

**Evidence:** `packages/subgraphs/src/runtime/formats/index.ts:36-37` (only standard-webhooks → `sign()`); `formats/raw.ts`, `formats/cloudevents.ts` (no SL sig). Existing verify: `@secondlayer/shared/crypto/standard-webhooks` `verify()` (~:63).

**Fix direction.** Attach a universal `webhook-id` + signature header (e.g. `X-Secondlayer-Signature`) across ALL formats regardless of body shape; export a verify helper covering them. Keep body shape format-specific; make authenticity universal.

---

## P1-6 — Chain subscriptions have no replay / catch-up  `[MEDIUM]`

**id:** `no-chain-replay-catchup` · status: known-open.

**Problem.** `replaySubscription` throws for `kind=chain` (it scans the subgraph's processed table, which chain subs lack). A chain receiver down longer than the outbox retry window (backoff to ~72h, then `dead`, swept >90d) permanently loses events; only recovery is DLQ requeue of rows that still exist. The evaluator itself self-recovers (persistent global cursor), so this is **receiver** downtime, not evaluator downtime.

**Evidence:** `packages/subgraphs/src/runtime/replay.ts:103-105` (throws for non-subgraph). Backoff/dead: `emitter.ts:35` `BACKOFF_SECONDS=[30,120,600,3600,21600,86400,259200]`, max_retries default 7. DLQ requeue (existing rows only): `packages/api/src/.../subscriptions.ts:375-401`. Evaluator is pure/range-driven: `trigger-evaluator-loop.ts:73-111`.

**Fix direction.** Support chain replay by re-running the evaluator over a historical block range (re-fetch canonical blocks from Index, re-match triggers, emit apply rows with replay dedup keys) — the matcher is already pure and range-driven.

---

## P1-7 — Streams has no SSE/websocket real-time surface  `[MEDIUM]`

**id:** `streams-realtime-push-surface` · status: known-open. (Founder leans SSE — see audit §6 Q4 + the standing answer below.)

**Problem.** The surface literally named "Streams" misses Kourier goal 5: all endpoints are GET JSON; "real-time" is SDK long-poll with 500ms empty backoff, so latency is poll-bounded, not chain-cadence. Impact is latency-only (poll fallback stays functional).

**Evidence:** `packages/api/src/routes/streams.ts` (only GET JSON endpoints); SDK poll `packages/sdk/src/streams/consumer.ts:88,162`. **Prior art to reuse:** subgraphs SSE `packages/api/src/routes/subgraphs.ts:1369` (`streamSSE` from hono/streaming) + SDK `packages/sdk/src/subgraphs/client.ts:336` (`subscribe()` over EventSource).

**Fix direction.** Add `GET /v1/streams/events/stream` (`text/event-stream`) that pushes new canonical events past a cursor, **reusing the same envelope + ed25519 signing**; expose `client.events.subscribe()` in the SDK over it. SSE = a server poll-loop wrapped in event-stream (like subgraphs) — keeps the immutable/cacheable model intact, no stateful socket infra. **This is the recommended shape** (see _context / audit §6 Q4).

---

## P1-8 — Cold bulk parquet manifest is sha256-only, not signed (G7)  `[MEDIUM]`

**id:** `streams-bulk-manifest-unsigned` · status: known-open.

**Problem.** The live lane is ed25519-signed; the bulk manifest is plain JSON with only per-file sha256 — a tampered manifest+file pair verifies cleanly. SDK throws `StreamsSignatureError` on hash mismatch, overstating the bulk-lane guarantee. The two availability lanes have asymmetric trust.

**Evidence:** `packages/indexer/src/streams-bulk/manifest.ts:7-34` (no signature field), `:36-71` (`createStreamsBulkManifest` emits unsigned); `packages/sdk/src/streams/dumps.ts:37-63` (verifies sha256 only). Reusable signer: `packages/api/src/streams/signing.ts` (`getStreamsSigner`, `STREAMS_SIGNING_PRIVATE_KEY` already in compose).

**Fix direction.** Sign the manifest at export with `STREAMS_SIGNING_PRIVATE_KEY` (embed `signature` + `key_id`, matches the R2-direct SDK path), publish alongside `latest.json`; SDK `dumps.list()` verifies the manifest signature before trusting any file sha256. **Strict rollout order** (G7 risks in `data-plane-gap-remediation.md`): ship signing + backfill historical manifests → THEN flip SDK verify on; SDK verify ships default OFF.

---

## Deliverable

A reviewed sprint plan grouping: (A) delivery-plane extraction + leader election (P1-1/P1-2, two-deploy cutover, shared leader util), (B) stream-completeness correctness (P1-3 stacking reorgs, P1-4 updates/deletes, P1-6 chain replay), (C) authenticity (P1-5 universal webhook sig, P1-8 signed bulk manifest with strict rollout), (D) Streams SSE lane (P1-7). Each task atomic + validated; changeset per package; respect the two-deploy cutover and signing-then-verify ordering risks.
