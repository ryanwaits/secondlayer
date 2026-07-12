---
"@secondlayer/shared": patch
---

`x402_payments` gains a `credited_at TIMESTAMPTZ` column (migration 0108) — the idempotency key for deposit crediting. Pre-existing non-pending deposit rows are backfilled to a non-null sentinel so a genuinely-uncredited confirmed deposit can be safely healed exactly once without risking a double credit on historical rows.
