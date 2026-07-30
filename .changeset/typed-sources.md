---
"@secondlayer/subgraphs": minor
---

Typed sources: the ABI and print machinery now actually types your handlers.

- **`prints` understands real payloads.** The vocabulary was seven flat `ColumnType` strings, so a nested payload could only be declared `"jsonb"` — which is why a handler reading flat `data.name` type-checked, deployed, and decoded to null on every event while BNS-V2 emitted `name` as a nested tuple. Fields can now be nested tuples, lists, or `{ type, optional: true }`; `event.data` is typed all the way down and an optional field becomes an optional KEY.
- **Declaring `prints` opts into runtime validation.** An event whose decoded payload does not match the declaration is skipped and logged (counted as `skipped` in the run result) rather than written as nulls. Never throws — a poisoned block that can't advance is incompatible with the checkpoint model.
- **The ABI on a source is validated at deploy.** `abi` was `z.record(z.any())`, so a raw Hiro/Clarinet ABI (`read_only` access, outputs wrapped as `{ type: … }`) passed and then mis-decoded `event.input` at runtime, per event, forever. It is now checked against the canonical `AbiContract` shape, and the error names the fix: run it through `normalizeAbi` from `@secondlayer/stacks/clarity`.
