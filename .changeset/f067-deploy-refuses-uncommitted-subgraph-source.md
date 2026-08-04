---
"@secondlayer/cli": minor
---

`sl subgraphs deploy` now refuses a source file that isn't committed to git — prompts to confirm interactively, errors in CI — unless `--allow-uncommitted` is passed; prevents the definition's only copy from ending up solely in the database
