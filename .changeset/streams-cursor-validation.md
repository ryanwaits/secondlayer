---
"@secondlayer/sdk": patch
---

Validate stream cursors when parsing. A malformed `from` cursor passed to `events.replay()` previously parsed to `NaN` and silently dropped all dump files / mis-seamed the live tail; it now throws `ValidationError`.
