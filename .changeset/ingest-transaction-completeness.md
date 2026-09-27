---
"@secondlayer/indexer": patch
---

Fail loud when a persisted block lands fewer txs than it received, self-heal a reorg's aftermath against the observer journal, and attest transaction membership (not just block identity) against the node's own tx merkle root. Integrity reports short blocks (`transactions` short of `blocks.tx_count`) alongside broken links.
