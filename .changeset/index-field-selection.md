---
"@secondlayer/sdk": minor
"@secondlayer/api": minor
---

Index reads take a `fields` selection, and the returned row type narrows to match.

```ts
const { events } = await sl.index.events.list({
  eventType: "ft_transfer",
  fields: ["recipient", "amount"],
});
events[0].asset_identifier; // ✗ not requested, not fetched, not in the type
```

- The server projects the SELECT, so an unrequested column is physically absent from the payload — and now absent from the type too, making a read of one a compile error instead of `undefined` at runtime.
- `cursor`, `block_height`, and `event_type` always come back: the first two are the consume contract, the third carries the union discriminant. Omitting them is not expressible.
- Omitting `block_time` lets the server **skip the `blocks` LEFT JOIN entirely** — it is not a column of `decoded_events` but a `to_timestamp()` off a join taken on every read. That is the measurable win here.
- `block_height` and `event_index` stay in the SQL SELECT regardless (cursor encoding and the reorg-span lookup read them) and are stripped from the response instead, so pagination and reorg reporting are unaffected by any projection.
- Unknown field names are refused with the list of columns available for that event type, rather than silently ignored.

This does **not** change your bill: Index meters per row read, not per field. What it buys is wire bytes and that dropped join.
