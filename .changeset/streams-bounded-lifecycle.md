---
"@secondlayer/sdk": minor
"@secondlayer/mcp": patch
"@secondlayer/shared": patch
---

Streams client requests (REST reads, the signing key, dumps and the SSE connect) now give up when no response headers arrive within `connectTimeoutMs` (default 30000, `0` disables). The timeout is retryable, so the consume loops retry it and `events.subscribe` reconnects; open streams are not cut off. `events.subscribe` takes an `onState` observer reporting `connecting`, `open`, `reconnecting` and `closed`.

`consume` (the batch iterator) and `events.stream` now run on the same loop as `events.consume`, so they share its page retry and yield the same values. A page that returns events without moving the cursor now throws `CURSOR_STALLED` instead of ending the stream without a word.

The HTTP MCP server closes sessions idle for 30 minutes, closes the transport when initialization fails, and registers `onclose` before handling the first request. The runtime supervisor will not start an already-running module or stop a stopped one.
