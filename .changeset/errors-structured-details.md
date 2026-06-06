---
"@secondlayer/shared": minor
---

`SecondLayerError` (and `AuthorizationError`) now accept an optional structured `details` payload, surfaced in `toJSON()` so HTTP error handlers can emit machine-readable hints alongside the message.
