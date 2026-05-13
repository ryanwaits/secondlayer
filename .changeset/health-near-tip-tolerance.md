---
"@secondlayer/indexer": patch
"@secondlayer/api": patch
---

loosen `nearTip` threshold from 60s → 300s. Under the AND-with-OR health logic shipped same-cycle, a sparse-but-keeping-up decoder (sBTC, BNS-V2 during quiet windows) would falsely flag unhealthy any time its checkpoint drifted more than a few blocks behind tip while no events matched its filter. 5 min tolerates normal block-time variance + sparse-event arrival without masking truly stuck decoders, which sit hours behind tip.
