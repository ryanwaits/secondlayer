---
"@secondlayer/cli": patch
---

`secondlayer index events` validates `--event-type` against the shared decoded event vocabulary locally (and lists those types in `--help`) instead of sending a typo or a missing type to the API.
