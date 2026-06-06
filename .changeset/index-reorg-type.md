---
"@secondlayer/sdk": minor
---

Type the Index `reorgs[]` field properly. The Index list envelopes (`/transactions`, `/contract-calls`, `/stacking`, and the ft/nft/event feeds) declared `reorgs: never[]`, forcing TS callers to cast even though the API returns real reorg records. They now use a new exported `IndexReorg` type (`{ id, detected_at, fork_point_height, old_index_block_hash, new_index_block_hash, orphaned_range: {from,to}, new_canonical_tip }`) so consumers can read `orphaned_range`/`new_canonical_tip` to reconcile a reorg without a cast.
