---
"@secondlayer/shared": minor
---

Decoder health reads the last-output time from `decoder_checkpoints.last_output_at`, stamped in the commit transaction when a commit wrote rows. `DecoderAdapterCommit` gains `output_count`, and `DecoderCheckpointsTable` gains `last_output_at`. Decoder liveness pings are batched into one statement and throttled. The migration drops the health-only `decoded_events_evt_canon_created_idx` index.
