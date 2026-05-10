---
"@secondlayer/cli": minor
---

feat(cli): `sl streams` family — `events`, `consume`, `tip`, `reorgs`, `canonical`

Mirrors the SDK Streams client. Reads `SL_STREAMS_API_KEY` from env (issue at `/platform/api-keys` with product=streams), supports `SL_API_URL` override for OSS / dev. `sl streams consume` emits one event per line as JSONL with `next_cursor` tracked on stderr — pipe directly into a downstream pipeline.
