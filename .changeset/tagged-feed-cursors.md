---
"@secondlayer/shared": minor
"@secondlayer/sdk": minor
---

Streams cursors on the Bitcoin feed (`chain=bitcoin`) and the vm clock (`clock=vm`) are now prefixed `btc:` and `vm:`. Untagged cursors still resume on every feed; a cursor tagged for another feed is a 400. `Cursor.parse` accepts tagged cursors.
