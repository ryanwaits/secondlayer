# @secondlayer/sdk — notes for coding agents

Five facts that are load-bearing. Everything else you can infer from the types;
these you cannot, and getting them wrong produces code that looks correct and
silently loses or corrupts data.

## 1. Reads need no key

`/v1/index/*` and the public subgraph reads are open. Construct the client with
no credentials and start reading:

```ts
import { Index } from "@secondlayer/sdk";

const sl = new Index();
const { events } = await sl.events.list({ eventType: "ft_transfer" });
```

Keys are for Streams, writes, and higher rate limits. Do not invent an
`apiKey` requirement or send a placeholder — an empty Bearer is worse than none.

## 2. Cursors are opaque

A cursor is `"<block_height>:<event_index>"`, and that is an implementation
detail you may read but must never construct, parse into, or compare
arithmetically. Pass back exactly what you were handed:

```ts
let cursor: string | null = null;
for (;;) {
  const page = await sl.events.list({ eventType: "ft_transfer", cursor });
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
  await saveCursor(tx, ctx.cursor);
},
```

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
already final.

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
  `retryAfterSeconds`, `docsUrl`, and `walk(predicate)` to find a cause. Retries
  are built in (`retryCount`/`retryDelay`); `onError` is a void observer, not a
  retry decision.

## More

- Docs, full text: <https://secondlayer.tools/llms-full.txt>
- Any page as markdown: append `.md` (e.g. `/docs/streams.md`)
- Deeper agent skill: `bunx skills add ryanwaits/secondlayer`
