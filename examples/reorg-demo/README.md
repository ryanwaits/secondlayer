# reorg-demo

Consumer-side reorg safety, made visible. The same feed is written to two tables
by the same handler — one with `onReorg`, one without — and you watch them
diverge.

```bash
bun install
bun run db          # from the repo root, if you don't already have a dev database
./run.sh
```

`DATABASE_URL` defaults to the dev database on port **5440**. Override it to
point somewhere else.

## What you see

Four sales land across blocks 100-103. Then the chain forks at 102, rows vanish,
the consumer rewinds, and the now-canonical block 102 is re-read. The frame is
redrawn in place and stays under 80 columns, so the whole story is still on
screen at the end:

```
  ⚡ REORG — the chain forked at block 102
     onReorg → DELETE 2 rows ≥ block 102
     checkpoint rewound to 101:2147483647

  ╔══════════════════════════════════╗  ╔══════════════════════════════════╗
  ║ WITH onReorg  ✓ correct          ║  ║ WITHOUT onReorg  ✗ corrupt       ║
  ╠══════════════════════════════════╣  ╠══════════════════════════════════╣
  ║  block 100   ALICE   u841        ║  ║  block 100   ALICE   u841        ║
  ║  block 101   BOB     u912        ║  ║  block 101   BOB     u912        ║
  ║  block 102   ERIN    u555        ║  ║  block 102   CAROL   u377        ║
  ╚══════════════════════════════════╝  ║  block 102   ERIN    u555        ║
                                        ║  block 103   DAVE    u108        ║
                                        ╚══════════════════════════════════╝
```

Two rows for block 102 and a phantom block 103 — a double-count that no error
ever announced.

## What's real and what isn't

**The chain is fabricated. The consumer path is not.** `fake-index.ts` is a
scripted history that speaks the real Index envelope (`contract_calls`,
`next_cursor`, `tip`, `reorgs`), and `new Index({ baseUrl })` points the real
SDK at it. `onBatch` and `onReorg` in `demo.ts` are copied verbatim from
[`../sales-index/indexer.ts`](../sales-index/indexer.ts).

Run it with the wire log to see the rewind is real:

```bash
SHOW_WIRE=1 ./run.sh
```

```
  [chain]  GET ?cursor=(none)            ->  4 calls, 0 reorgs
  [chain]  GET ?cursor=103:0             ->  0 calls, 1 reorgs
  [chain]  GET ?cursor=101:2147483647    ->  1 calls, 1 reorgs
```

That third cursor is `Cursor.atHeight(102)` — the foot-of-block sentinel. The
rewind is **inclusive** of the fork block, because the new chain re-supplies it.

## The two things worth stealing

**The rollback is `>=`, not `>`.** The fork block itself is orphaned along with
everything above it.

**The rollback and the rewound checkpoint commit in one transaction.** Deleting
alone would leave the old, higher cursor on disk — a crash between the two
writes resumes *above* the fork, the deleted range is never re-read, and the gap
is permanent and silent. `onReorg` receives that rewind cursor as `ctx.cursor`.
