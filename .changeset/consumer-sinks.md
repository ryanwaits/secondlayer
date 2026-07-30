---
"@secondlayer/sdk": minor
---

Sinks: the consume loops can now own the three hard parts of a durable indexer — checkpoint persistence, rows+cursor atomicity, and reorg rollback — instead of teaching them in doc comments.

- New `@secondlayer/sdk/sinks/kysely` subpath: `kyselySink(db, { id, tables, height })`, keyed on the query builder so the `DB` schema generic flows through (`tables` is `(keyof DB)[]`, `height` must exist on every declared table, `ctx.tx` is a typed `Transaction<DB>`). Rows and cursor commit in ONE transaction; a handler throw aborts both; reorg rollback (inclusive `>=` fork delete + rewound cursor) is automatic and UNCONDITIONAL — the old silent-skip when `onReorg` was omitted is unrepresentable with a sink. Per-id advisory lock stops replica double-writes. Kysely is an optional peer dependency; the root entry stays dependency-free.
- Height-stamp rollback is v1 and append-only-projections only: a declared table missing the `height` column fails loudly at first use, never silently at reorg time.
- New `consumerHealth({ staleAfterMs })` (returns a fetch handler — liveness is "did a page land recently", never lag) and `shutdownSignal()` (SIGTERM/SIGINT finishes the in-flight batch, then stops). New `onProgress` fires once per page before any early return.
- New `decode(event)` on Streams: one call returning the same flat, `event_type`-discriminated row Index serves — or pass `decoded: true` to `streams.events.consume` and decoding never appears in your code. The 22 per-type `is*`/`decode*` guard+decode exports are deprecated (they return internal DB-row shapes) and will be removed in the next major.
- The flagship `examples/sales-index` is now one file (61 code lines, down from 167 across three) with zero checkpoint, reorg, or shutdown code — gated in CI so it stays that way.
