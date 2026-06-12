---
"@secondlayer/subgraphs": patch
---

ctx.increment debits no longer trip CHECK constraints on existing rows — Postgres validates the proposed INSERT tuple before ON CONFLICT arbitration, so every negative delta against an existing uint balance errored; increments now UPDATE-first with a guarded INSERT for missing rows (genuine negatives still fail loudly)
