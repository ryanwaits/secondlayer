---
"@secondlayer/api": patch
"@secondlayer/sdk": minor
---

Advertise the seekable retention floor on Streams `/tip` and `/usage`: `oldest_seekable_height` + `oldest_cursor` (the oldest height/cursor the live API serves for the caller's tier; `null` = unlimited). Consumers can now tell how far back the live lane goes before falling to the cold dumps lane. The SDK `StreamsTip` type carries the new optional fields.
