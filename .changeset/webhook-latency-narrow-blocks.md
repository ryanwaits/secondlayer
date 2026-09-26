---
"@secondlayer/api": patch
---

`/v1/index/blocks?tip_only=true` accepts `event_types` (comma-separated): narrows the tip it answers (and, with `wait`, what counts as "nothing new") to the MIN committed height over just those types, instead of the global floor over every classic decoder. Fixes a busy-idle pattern where an unrelated decoder committing (any of ~15, several times a block) moved the global floor and made an unrelated long-poll return immediately instead of holding.
