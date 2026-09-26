---
"@secondlayer/indexer": patch
---

Adds a `classic_decode_cycle` log line per decode cycle (trigger, height range, pages, rows, read/commit/total timing) for tracing decode-latency outliers. Also closes a dropped-wake window: a NOTIFY landing while a cycle was still running was silently lost (nobody was an active waiter), so the loop waited out the empty-poll backoff instead of re-running right away — `waitForNextClassicDecodeCycle` now checks the wake bus's generation and reruns immediately when it moved during the cycle.
