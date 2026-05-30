---
"@secondlayer/indexer": patch
---

Harden leader election against split-brain on connection reset. The heartbeat now verifies the advisory lock is still held by the current backend (via `pg_locks`) instead of a plain `SELECT 1`, so a transparent driver reconnect — which silently drops the session-scoped lock — is detected within one heartbeat and the instance relinquishes, instead of two instances both believing they're leader.
