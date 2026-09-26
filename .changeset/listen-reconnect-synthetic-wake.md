---
"@secondlayer/shared": patch
---

`listen()`'s LISTEN connection already reconnects on its own (postgres.js re-issues LISTEN with backoff), but never replayed a NOTIFY that fired while it was down, so a waiter could be stranded until the next NOTIFY. Every reconnect now logs `listener_reconnected` and fires one synthetic wake (undefined payload) so callers re-check current state.
