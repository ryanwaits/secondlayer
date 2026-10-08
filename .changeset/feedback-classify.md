---
"@secondlayer/worker": minor
---

Hosted worker labels and routes new feedback tickets every minute: deterministic rules first, then the configured classifier; the model never hides a ticket. The model can lower a ticket to low_priority only after an eval gate: export a labelling set with `bun scripts/ops/feedback-queue.ts --status classified --since 30 --jsonl`, label at least 50 rows, run `scripts/ops/classifier-compare.ts` per provider, and flip `MODEL_ROUTING_ENABLED` in its own commit only at 0.85 kind agreement.
