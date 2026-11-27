---
"@secondlayer/shared": major
---

`decoded_events` stores a `print` value once, as the canonical Clarity bytes in the new `raw_value` BYTEA column. New print rows have `payload` NULL; other event types keep `payload` as a jsonb object instead of a double-encoded string. Self-hosters reading `decoded_events.payload` directly for print events must read `raw_value` instead, or use `printPayloadFromStored` from `@secondlayer/shared/streams-rows`. REST responses are unchanged.
