---
"@secondlayer/cli": minor
---

Drop the hidden `sl instance` command family (`create`, `resize`, `suspend`, `resume`, `delete`, `keys`, `db`). These targeted the dedicated per-tenant provisioner and have been hidden + deprecated since the 2026-05-14 shared-rip pivot. `resolve-tenant` retained as a thin session helper for the workload commands.
