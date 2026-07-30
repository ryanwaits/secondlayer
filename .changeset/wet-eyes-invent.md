---
"@secondlayer/sdk": minor
---

Field projection on the transfer feeds. `sl.index.ftTransfers.list({ fields: ["amount", "sender"] })` (and `nftTransfers`) returns rows carrying only those columns plus `cursor`/`block_height`/`event_type`, the row type narrows to match, and `walk` and the callable shorthand narrow identically. Omitting `block_time` also lets the server skip the blocks join, the same win `/v1/index/events` already had.

This corrects the 6.44.0 note that skipped these feeds as "5-8 column rows": that count missed the 12-column base the transfer types extend. A transfer row is 17 columns — wider than the withdrawals that were projected. `blocks` alone stays unprojected, for a checked reason: it is 8 columns read off a single table, so there is no join for a projection to skip.
