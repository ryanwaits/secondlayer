---
"@secondlayer/shared": patch
"@secondlayer/api": patch
"@secondlayer/worker": patch
---

A signed-out docs key is minted once a day per IPv4 address or IPv6 /64 and at most 500 times a day overall. A docs key reads two requests at a time, so parallel reads can no longer run far past its 100,000 row limit. A ghost account can no longer hold an email (database check), and the ghost purge deletes in batches, skips a row it cannot delete, and removes keyless ghosts after 8 days.
