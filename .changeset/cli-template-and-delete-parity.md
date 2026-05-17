---
"@secondlayer/cli": patch
---

- `sbtc-flows` and `bns-names` templates: read the print-event payload from `event.topic` + `event.data` (camelized) instead of the non-existent `event.payload`. The old shape silently produced zero rows. `sbtc-flows` also ships with a default `startBlock` so a fresh deploy doesn't backfill from genesis.
- `sl subgraphs delete <name>` is now idempotent: a second call on an already-deleted subgraph prints a friendly "not found (already deleted?)" message and exits 0, matching `sl subscriptions delete` behavior.
- `sl subscriptions delete/rotate-secret/requeue/replay` no longer crash with `ExitPromptError` when stdin isn't a TTY; they print "Re-run with -y to skip confirmation." and exit 1, matching `sl subgraphs delete`.
