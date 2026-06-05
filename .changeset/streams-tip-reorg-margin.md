---
"@secondlayer/api": patch
---

fix(streams): clamp servable tip by a fixed block margin instead of subtracting lag_seconds from block height (unit mismatch held the tip ~80s behind chain post-Nakamoto)
