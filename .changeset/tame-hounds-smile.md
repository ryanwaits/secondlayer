---
"@secondlayer/indexer": patch
---

Fix a reorg replace that could halt ingest: `persistBlock` deleted events by block height only, but the FK is on tx id. A transaction re-mined at a new height across a fork keeps its first-seen `block_height` while its events land at the new height, so those stragglers survived the delete-by-height and blocked the transaction delete with `events_tx_id_fkey`. The delete now also scopes by the tx ids being replaced.
