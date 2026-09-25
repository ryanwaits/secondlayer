---
"@secondlayer/cli": minor
---

`secondlayer setup` no longer installs a native terminal UI — interactive runs ask plain `@inquirer/prompts` questions for whatever `--network`/`--node-mode`/`--against` you didn't pass, working under node as well as Bun. `--against` now defaults to the official archive manifest instead of failing without it.
