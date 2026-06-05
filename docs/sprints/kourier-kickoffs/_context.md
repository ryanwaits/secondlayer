# Kourier Parity — Shared Kickoff Context

> Included by reference in each priority kickoff (p0/p1/p2). Read this first.

## Mission

Drive Secondlayer's data plane to near-1:1 parity (and beyond) with Project Kourier — Hiro's plan to break the monolithic API into lower-level, as-needed microservice primitives. We already exceed Kourier on agent-native (MCP) authoring, typed-ORM codegen, live ed25519 signing, immutable-page caching, and reorg-rollback delivery. Remaining work is mostly **service isolation, real-time push, and reorg/replay completeness**.

## Kourier north-star (the article)

- **M1 Raw Event Capture** → our **Streams**: immutable, log-like, pause/resume, aggressively cacheable, node-free availability, future crypto proofs.
- **M2 Data Transformation** → our **Index**: semantic domain objects (blocks, confirmed/mempool tx, FT/NFT/STX/stacking events), canonical-only sync, canonical block-hash map.
- **Tooling** → our **Subgraphs** (custom views + typed ORM + trait/contract filters) and **Subscriptions** (real-time push/webhooks).
- **5 DX/perf goals:** (1) no Stacks node, (2) easy access to specific data types (e.g. all txs for a contract), (3) fast sync, (4) update/re-sync as needed (schema changes), (5) real-time streaming.

## Source documents (read for full context)

- `docs/audits/kourier-parity-audit.md` — the service-centric audit this work derives from (scorecard, per-service gap tables, "where we exceed", roadmap §5, founder questions §6).
- `docs/audits/data-plane-audit.md` — prior boundary-centric audit (G1–G9 framing).
- `docs/sprints/data-plane-gap-remediation.md` — prior per-gap remediation roadmap; reuse its hardened sub-plans where a gap recurs.

## Already shipped (do NOT re-plan these; build on them)

G1 schema-contract belt (`DbReadRow` + `SOURCE_READ_COLUMNS` + CI drift test); G2 pox-4 over Index HTTP + stacking default-on; G3 reorg db-event vocab single-sourced from `@secondlayer/shared`; G4 source/target DB split **wired** (chain→`getSourceDb`, decoded→source, dual-migrate, `assertDbSplit`, profile-gated `postgres-platform`) — **but dormant in prod** (see P0); G5a Redis rate-limit (fail-open); G-txreorg `reorgs[]` on `/v1/index/transactions` + `/contract-calls`.

## House rules (enforce in every plan)

- Conventional single-line commits; no `-m` body, no plan/sprint/phase process labels in messages.
- Version-bump commit message = `chore: version packages`.
- Always create a changeset for every changed package; `api`/`indexer` are private (changesets auto-skip indexer; api keeps a changeset per house rule). Release via the bun release workflow.
- Delete over refactor during deprecations.
- Every push to main triggers a full Deploy → 1-2 min 502 window. Prod SSH: `ssh ryan@claude-mini` → `ssh app-server`/`ssh node-server`; compose at `/opt/secondlayer/docker`; postgres = `secondlayer-postgres-1` (user/db `secondlayer`).
- DB-gated tests use local Postgres `127.0.0.1:5440`, postgres/postgres, db `secondlayer`.
- Be terse; sacrifice grammar for concision.

## Plan format (produce this, per global CLAUDE.md)

Structure as **sprints** (each demoable/runnable) of **atomic, single-commit tasks**. Every task: explicit file/function/type names + a validation step (test/build/manual). Make implicit deps explicit. **Before finalizing, spawn a general-purpose subagent to review the plan** (atomic? validation clear? sprints demoable? missing deps?) and fold in feedback. End with unresolved questions.

## How to run a kickoff session

1. Read this file + `docs/audits/kourier-parity-audit.md` + the priority file (p0/p1/p2).
2. For each finding: open the cited `file:line`, confirm the current state still matches (code moves), and diagnose.
3. Resolve or surface the founder decisions called out in the priority file.
4. Produce the sprint plan (format above), review via subagent, then implement sprint-by-sprint with changesets.
