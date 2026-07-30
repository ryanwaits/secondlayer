---
"@secondlayer/shared": minor
---

`DECODED_EVENT_TYPES` / `DecodedEventType` are now re-exported from their canonical home in `@secondlayer/stacks/filters` (shared depends on stacks, so the leaf owns the vocabulary). All existing imports keep working unchanged.

Removed: the dead `schemas/filters.ts` module (a third, incompatible copy of the chain-event filter union with `number` amounts — zero importers anywhere; its zod schemas were compiled and shipped as dead weight). Its one salvageable asset, the validated Stacks-principal check, now lives in `@secondlayer/stacks/filters` as `isPrincipal`/`assertPrincipalish` with a branded `Principal` type.
