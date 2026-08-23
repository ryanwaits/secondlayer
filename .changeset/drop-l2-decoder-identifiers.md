---
"@secondlayer/indexer": patch
"@secondlayer/api": patch
---

Drop leftover `l2*` identifiers from the decode plane.

`Database` already has `decoded_events` and `decoder_checkpoints`, so the local
`L2Database` overlay and `as unknown as` cast are gone. Live names now match the
service (`decoder`), table (`decoder_checkpoints`), and AGENTS.md rule.
