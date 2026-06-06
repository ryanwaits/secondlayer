---
"@secondlayer/cli": patch
---

Source the `sl streams` event-type vocabulary from `@secondlayer/shared` (`STREAMS_EVENT_TYPES`) instead of a hand-duplicated literal, so the CLI can't advertise or accept a stale subset of the Streams event types. A drift test locks the two together.
