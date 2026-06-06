---
"@secondlayer/api": patch
---

Enrich the Streams retention 403 with a structured `details` body — `reason: "RETENTION"`, `oldest_seekable_height`, `oldest_cursor`, `dumps_manifest_url`, and a hint — so a caller hitting the live retention floor is pointed at the cold dumps lane instead of dead-ending. The global error handler now merges `error.details` into the response.
