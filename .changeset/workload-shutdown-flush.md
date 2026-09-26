---
"@secondlayer/workload": patch
---

`shutdown()` used to clear the meter timers and `process.exit(0)` straight away, dropping up to an hour of accumulated `memory.gb_hour` plus anything sitting in a pending retry buffer on every restart or deploy. It now runs one final flush of every meter's live accumulator and pending buffer (same idempotency keys, so a re-send is safe), bounded by a 5s timeout, and ignores a second SIGINT/SIGTERM while that flush is in flight.
