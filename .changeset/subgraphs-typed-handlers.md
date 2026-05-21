---
"@secondlayer/subgraphs": major
---

Typed subgraph handlers. `event` is now inferred from each source's `type` (e.g. a `print_event` source gives `event.topic: string`, an `ft_transfer` source gives `event.amount: bigint`), and `ctx` is typed against the schema — table names and row columns in `ctx.insert`/`update`/`upsert`/etc. are checked. Removes the need for `event as {...}` casts.

BREAKING: handler `event` and `ctx` are now strictly typed, so existing handlers may surface new type errors (usually real shape mismatches). No runtime behavior changes.
