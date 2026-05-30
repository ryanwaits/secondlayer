---
"@secondlayer/indexer": minor
---

Add a Postgres advisory-lock leader-election primitive (`withLeaderLock`). Exactly one indexer process holds the lock (on a dedicated long-lived connection) and runs leader-only work; standbys poll and take over if the leader exits or its connection dies. Backend is injectable for testing.
