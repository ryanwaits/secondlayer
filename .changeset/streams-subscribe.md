---
"@secondlayer/sdk": minor
---

Add `client.events.subscribe(...)` for the real-time Streams SSE push surface. It calls `onEvent` for each new canonical event as the server pushes it — chain cadence rather than the long-poll's 500ms empty backoff — and returns an unsubscribe function. Unlike a browser `EventSource` it uses a fetch-based reader so it can send the mandatory `Authorization` header (Streams is key-mandatory) and an `AbortSignal`; it reconnects from the last delivered cursor on a dropped connection. When the client was created with `verify`, each frame's inline ed25519 signature is checked before the event is delivered.
