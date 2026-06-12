---
"@secondlayer/cli": patch
---

create --from-contract / codegen --payloads no longer demand `sl login` — print-schema is an open read, falls back to an anonymous client when no session/key resolves
