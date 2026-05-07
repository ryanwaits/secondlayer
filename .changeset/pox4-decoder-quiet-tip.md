---
"@secondlayer/indexer": patch
---

Fix PoX-4 decoder showing as unhealthy during the long quiet windows between cycle-prep events. When the decoder catches up to tip with no pox-4 txs in range, it now advances the checkpoint to the latest canonical block (or bumps `updated_at` if already at tip) so the health endpoint's `checkpoint_recent` predicate stays true. Without this, the L2 decoder service container would flap to unhealthy status whenever no pox-4 calls had landed in the past 5 minutes — common given pox-4 activity is sparse outside cycle transitions.
