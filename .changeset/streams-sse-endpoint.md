---
"@secondlayer/api": patch
---

Add a real-time Streams push surface: `GET /v1/streams/events/stream` (`text/event-stream`). It's a server-side poll-loop over the same forward event cursor wrapped in SSE — new canonical events are pushed at poll cadence instead of the SDK's long-poll with empty backoff, keeping the immutable/cacheable read model intact. Without a start cursor it live-tails from the current reorg-clamped tip; pass `from_cursor` to resume precisely. Each event frame is independently ed25519-signed inline as `{ event, sig, key_id }` (SSE has no per-frame headers) using the same Streams signing key as the JSON lane, with a 20s `ping` heartbeat to keep idle connections alive.
