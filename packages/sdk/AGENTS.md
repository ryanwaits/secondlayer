# @secondlayer/sdk — notes for coding agents

Five facts that are load-bearing. Everything else you can infer from the types;
these you cannot, and getting them wrong produces code that looks correct and
silently loses or corrupts data.

## 1. `/v1` reads are open on loopback; `/api` needs the token

`sl.index.*`, `sl.streams.*`, `sl.subgraphs.rows`, and the typed `subscribe`
read `/v1`, open on loopback. Construct the client with no credentials and start reading:

```ts
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer();
const { events } = await sl.index.events.list({ eventType: "ft_transfer" });
```

Everything else under `sl.subgraphs.*` and all of `sl.subscriptions.*` calls
`/api`, which needs `INSTANCE_TOKEN` as soon as one is configured, loopback
included, and `secondlayer init` always configures one. `/v1` needs it too once
the API is bound beyond loopback. Every client reads `INSTANCE_TOKEN` from the
env when `apiKey` is omitted, so the golden path is: omit `apiKey`, export the
token. Do not send a placeholder; an empty Bearer is worse than none.

## 2. Cursors are opaque

A cursor is `"<block_height>:<event_index>"`, and that is an implementation
detail you may read but must never construct, parse into, or compare
arithmetically. Pass back exactly what you were handed:

```ts
let cursor: string | null = null;
for (;;) {
  const page = await sl.index.events.list({ eventType: "ft_transfer", cursor });
  if (page.events.length === 0) break;
  cursor = page.next_cursor;      // ✓
  // cursor = `${lastHeight}:0`;  // ✗ — skips events, silently
}
```

`Cursor.atHeight(h)` exists for "start at the foot of block h"; use it rather
than hand-rolling a sentinel.

## 3. Reorg rollback is INCLUSIVE

`onReorg` hands you `reorg.fork_point_height`. Delete rows at
`_block_height >= forkHeight`, not `>`. The fork block itself is replaced, so an
exclusive delete leaves exactly one block of orphaned rows behind — the hardest
kind of corruption to notice, because everything downstream still looks
consistent.

```ts
onReorg: async (reorg, ctx) => {
  await tx.deleteFrom("my_rows").where("height", ">=", reorg.fork_point_height).execute();
  await saveCursor(tx, ctx.cursor); // string, or null for a fork at genesis
},
```

Three more reorg facts the loop enforces so you do not have to:

- **Never rewinds forward.** A page read from below a fork still reports that
  fork. Nothing past it has been written, so the loop skips the rollback and
  delivers the page; `onReorg` fires only for forks at or below the checkpoint.
- **Idle tip is covered (Streams).** A page only reports reorgs overlapping its
  own span, so on every empty page the Streams loop also calls
  `reorgs.list` (one extra request per idle poll) and rolls back anything it
  finds. Index has no reorg list; a fork while idling is seen once a page
  overlaps it.
- **Rollback depth is capped.** The fork point is server supplied and drives a
  `DELETE ... >= fork` on every declared table, so a rewind more than
  `maxRollbackDepth` blocks (default 1000) below the checkpoint throws a
  `ValidationError` before the sink runs. Raise it only for a source you trust.
- **Rollback is at-least-once across restarts.** Applied reorgs are deduped in
  memory only. A consumer restarted at a checkpoint below a recent fork's
  orphaned tip sees that fork again, fires `onReorg` again, and re-reads.
  Correct (the rollback is idempotent, the re-read is a no-op on keyed rows)
  but not free: persist a checkpoint above the fork to stop it.

## 4. Rows and the cursor commit in ONE transaction

If they commit separately, a crash between them either replays a batch (double
counts) or skips it (missing rows). There is no ordering that avoids both.

Prefer a sink, which owns this by construction — you write rows, it commits them
with the checkpoint and handles the rollback:

```ts
import { kyselySink } from "@secondlayer/sdk/sinks/kysely";

await sl.streams.events.consume({
  sink: kyselySink(db, { id: "my-indexer", tables: ["transfers"], height: "height" }),
  onBatch: async (events, _envelope, ctx) => {
    for (const e of events) await ctx.tx.insertInto("transfers").values(...).execute();
  },
});
```

Hand-rolling it is allowed, but the checkpoint write must be inside the same
transaction as the row writes.

## 5. `walk()` is not reorg-safe

`walk()` iterates a fixed range for backfills and analysis. It does not surface
reorgs and does not rewind. Anything writing durable state off the tip belongs
in `consume()` with `onReorg` (or a sink). Use `walk()` for history that is
already final. `batchSize` tops out at 1000 (the largest page the Index
serves); above that `walk()` throws `ValidationError` instead of paging in
silently smaller steps. A walk ends only when the server stops advancing
`next_cursor`, never on a short page.

## 6. `replay()` dump delivery is file-granular, at-least-once

`events.replay({ from })` hands `onDumpFile` every dump file ending above
`from`, whole. The file that straddles `from` includes rows at or below it, so
skip those with `ctx.from` (the same cursor) or key rows by `cursor` so a
re-run is a no-op. Files ending at or below `from` are not delivered.

```ts
onDumpFile: async (file, { from }) => {
  const rows = await readParquet(await streams.dumps.download(file));
  await insert(rows.filter((r) => from === null || isAfter(r.cursor, from)));
},
```

---

## Shapes worth knowing

- **`decoded: true`** on `streams.events.consume` delivers the flat,
  `event_type`-discriminated rows Index serves, so Streams and Index handlers
  read identically. Prefer it over the individual `is*`/`decode*` helpers.
- **Labelled filters**: `filters: { <label>: {...} }` plus `on: { <label>: handler }`
  runs two unrelated concerns through one loop, one cursor, one checkpoint. Each
  label's declared `types` narrows its handler.
- **Field selection**: `fields: ["recipient", "amount"]` on Index reads projects
  the SELECT server-side; unrequested columns are absent from the row *and* the
  type. `cursor`, `block_height`, and `event_type` always come back.
- **Errors**: everything derives from `SecondLayerError` — `code`, `retryable`,
  `retryAfterSeconds`, `docsUrl`, and `walk(predicate)` to find a cause. Every
  failure status keeps the server's `{error, code}` envelope, Streams and Index
  alike; a 409 `OPERATION_IN_PROGRESS` on deploy/reindex/backfill is a plain
  `ApiError`. `context()` never throws: each field is `{ value, error? }`.
- **Verification**: `verify: true` fetches the signing key once and caches
  only a successful fetch (a 5xx there is a retryable `StreamsServerError`).
  Over plain http off loopback it requires `verify: { publicKey }`.
- **Retries**: `consume()` and `walk()` retry each page fetch on 429/5xx/network
  (`retryCount` default 3, `retryDelay` default 1000 ms, `Retry-After` honored);
  `onError` is a void observer, not a retry decision. One-shot reads (`list`,
  `get`, `discover`) do not retry; wrap them yourself if a blip must not fail
  the call. Index and REST requests (`Index`, `Contracts`, `Subgraphs`) time
  out after `requestTimeoutMs` (default 30 s, `0` disables) as a retryable
  `ApiError` with code `REQUEST_TIMEOUT`, so a hung socket trips the retry
  policy instead of stalling a loop. Streams requests do not time out yet.
  `signal` on `walk()` cancels the in-flight request and the walk rejects
  with the signal's reason at every boundary, so a walk that returns without
  throwing reached the end of the feed.

## More

- Docs, full text: <https://secondlayer.tools/llms-full.txt>
- Any page as markdown: append `.md` (e.g. `/docs/streams.md`)
- Deeper agent skill: `bunx skills add ryanwaits/secondlayer`
