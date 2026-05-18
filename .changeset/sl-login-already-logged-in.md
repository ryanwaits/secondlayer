---
"@secondlayer/cli": minor
---

`sl login` now detects an existing session and asks before re-running the magic-link flow. Pass `-f`/`--force` to skip the check. Non-TTY runs short-circuit with a hint to use `sl logout` or `--force`.
