---
"@secondlayer/shared": patch
---

Adds nullable `blocks.tx_count`, set at persist time, so downstream completeness checks can compare it against the actual `transactions` row count for a height. Adds `findShortBlocks` to the integrity query set.
