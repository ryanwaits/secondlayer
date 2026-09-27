---
"@secondlayer/indexer": patch
---

Adds `repair-from-journal.ts`: diffs a canonical height's `transactions` against its own observer-journal payload and, with `--apply`, restores it through the normal persist path. Dry-run by default; `--verify-node` cross-checks the repaired tx set against the node's own tx merkle root.
