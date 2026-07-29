---
"@secondlayer/stacks": patch
---

Fix `POX5_ACTIVATION_BURN_HEIGHT_MAINNET` being typed as `unknown` in 2.19.0. Aliasing it to `EPOCH_4_ACTIVATION_BURN_HEIGHT_MAINNET` left the declaration without an explicit annotation, so the `.d.ts` emitter fell back to `unknown` and any arithmetic or numeric comparison against the constant failed to typecheck. It is annotated explicitly again and resolves to the `960230` literal, as it did in 2.18.0.
