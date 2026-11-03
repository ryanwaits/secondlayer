---
"@secondlayer/cli": minor
---

`subgraphs deploy` no longer needs `@secondlayer/subgraphs` installed next to the file, and no longer blocks on an uncommitted source file: it warns instead. `--allow-uncommitted` now just silences that warning.
