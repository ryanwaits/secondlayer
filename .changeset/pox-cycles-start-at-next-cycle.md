---
"@secondlayer/api": patch
"@secondlayer/web": patch
---

`/v1/index/pox/cycles` without a cursor now starts at the next reward cycle instead of the farthest future one a PoX-5 bond can lock; pass a higher `cursor` to reach those far-future cycles.
