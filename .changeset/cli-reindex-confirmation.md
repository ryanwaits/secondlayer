---
"@secondlayer/cli": minor
---

feat(cli): `sl subgraphs reindex` now prompts for confirmation by default

Reindex is destructive — it drops existing rows in the range and reprocesses. Previously it ran silently. Now:

- TTY: prompts `Reindex subgraph "<name>" for blocks [from, to]? Existing rows in this range will be dropped and reprocessed.` Defaults to **no**.
- Non-TTY (CI, pipelines): exits non-zero with a hint to use `-y`.
- New `-y, --yes` flag skips the prompt.

Matches the existing safety pattern on `sl subgraphs delete`.
