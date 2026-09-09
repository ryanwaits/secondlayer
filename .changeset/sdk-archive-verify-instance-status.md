---
"@secondlayer/sdk": minor
"@secondlayer/shared": minor
"@secondlayer/cli": patch
---

Add `sl.archive.verify` (instance `POST /v1/archive/verify`) and
`sl.instance.status`/`diagnose`. `context()` includes instance
diagnosis so an empty index names bootstrap. Diagnosis helpers move
to shared so CLI and SDK share the verdict.
