---
"@secondlayer/shared": patch
---

`WakeBus` now exposes `generation()`, a counter bumped once per NOTIFY. Lets a waiter that checked state, then registered to wait, tell whether a NOTIFY landed in between — closing a lost-wakeup race no `wait()`-only API could detect.
