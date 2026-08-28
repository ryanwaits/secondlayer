---
"@secondlayer/cli": minor
---

`bootstrap` resumes a torn import per dataset: blocks, transactions, and events each keep their own high-water mark, so a run that died after the blocks pass loads the transactions and events it never reached instead of calling the restore complete, and a load that finished without writing progress is verified and finalized on re-run rather than refused. `--from-block` restores verify only the ranges they loaded, so a forward-only restore no longer exits divergent over history it declared out of scope. The post-load check now covers blocks, transactions, and events; `--verify blocks` opts down to block identity alone. Against the official archive, presigned URLs are issued in load order and re-issued before they expire, so a charge lands right before its bytes are used.

`repair --apply` rewrites a fixed block together with its transactions and events from the archive, in one transaction per partition, and re-verifies all three datasets. When the reference has no transactions or events partition for a height, the block is rewritten alone, the height is named with a `bootstrap --from-block H --to-block H` remedy, and the exit is 1, never "re-verified clean".
