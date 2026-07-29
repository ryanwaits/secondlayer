---
"@secondlayer/sdk": minor
---

`index.events.list`, `.walk`, and `.consume` are now generic over the `eventType` literal, so the rows they hand back are narrowed to that event's own shape. `consume({ eventType: "ft_transfer" })` gives `onBatch` an `IndexFtTransfer[]` with `amount` and `sender` directly reachable; `"print"` gives `IndexPrint[]` with `payload.topic`.

Every handler used to open with `if (e.event_type !== "ft_transfer") continue` purely to satisfy the compiler, because the rows arrived as the full `IndexEvent` union regardless of what was asked for.

Non-breaking. A non-literal `eventType` still yields the union, so dynamic callers are unaffected, and `IndexEvent[]` remains assignable where it was before. The narrowing helper is exported as `IndexEventOf<T>`.
