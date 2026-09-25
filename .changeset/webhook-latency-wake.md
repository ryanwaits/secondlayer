---
"@secondlayer/api": minor
---

Chain webhooks and Index consumers no longer have to poll blind. Ingest and every decoder checkpoint now NOTIFY Postgres on commit, so the Streams tip cache drops stale entries immediately instead of waiting out its TTL, and `/v1/index/events` and `/v1/index/blocks` accept `wait` (seconds, max 25): an empty page holds the connection open and returns the moment new data commits or `wait` elapses, instead of an immediate empty answer. Omitting `wait` is unchanged. A self-hosted instance from before this shipped rejects the unrecognized param with a 400.
