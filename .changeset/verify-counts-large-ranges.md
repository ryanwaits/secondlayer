---
"@secondlayer/shared": patch
"@secondlayer/cli": patch
---

`sl verify --counts` and `sl repair` count child rows with a plain count instead of building a range digest, so busy ranges no longer hit Postgres's 1 GB string limit.
