---
"@secondlayer/sdk": minor
---

`streams.events.subscribe` no longer loses the event whose handler threw: the resume cursor advances only after `onEvent` resolves, so a failed insert sees the same event again on reconnect (at-least-once; key durable writes by `cursor`). Reconnects back off from `reconnectDelayMs` (1 s) to 30 s with jitter, after a clean server close too, reset once a frame arrives, and never undercut a `Retry-After`. A socket that goes quiet for `staleAfterMs` (60 s, three heartbeats) is cancelled and reopened instead of hanging forever. Non-OK responses map to the same errors the rest of the client throws (`AuthError`, `RateLimitError`, `ValidationError`, `StreamsServerError`); a 401, other 4xx, or a bad signature ends the loop through `onError` and rejects the handle's new `done` promise instead of retrying every second. The unsubscribe function still works as before; it now carries `done`. `subscribe` stays reorg-unaware: durable writers use `consume()`.
