---
"@secondlayer/shared": patch
---

Add the `hosted_stack_state` table: the real state of each hosted stack, reported by the workload host. The balance alert and the credits usage response (`service.stack`) read it instead of guessing from metering heartbeats.
