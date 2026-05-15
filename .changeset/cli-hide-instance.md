---
"@secondlayer/cli": patch
---

Hide `sl instance` from `--help` and drop stale "instance" / "tenant" copy from quickstart, `whoami`, and `project create` next-step hints. Beta runs on the shared platform — no per-account instance to manage. Commands still resolve if invoked explicitly so the dormant path can be re-surfaced when paid tiers return.
