---
"@secondlayer/subgraphs": patch
---

Adds defense in depth against the chain evaluator's `wait` busy-loop regression: even when a tick asks the server to hold the response, it only re-arms immediately (0ms) if the wait actually held (found new data, or genuinely consumed most of the requested window) — otherwise it falls back to the plain poll interval, so a server that answers `wait` instantly can never turn into a tight loop again. The emitter's `webhooks:new_outbox`/`webhooks:changed` LISTEN also logs the channels and redacted DB host it connected to at startup.
