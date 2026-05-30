---
"@secondlayer/sdk": major
---

`StreamsEvent` is now a discriminated union keyed on `event_type`, so `event.payload` narrows to a typed per-type shape (e.g. `FtTransferPayload`, `PrintPayload`) once the type is checked — no manual casting or guard call needed.

BREAKING: `payload` is no longer `Record<string, unknown>`, and `StreamsEventPayload` is now the union of the per-type payloads. Code that read arbitrary keys off `event.payload` without first narrowing on `event_type` (or using a guard like `isFtTransfer`) will now fail to type-check. Narrow on `event_type`, use the `isX`/`decodeX` helpers, or cast untyped wire data to the specific payload type.
