---
"@secondlayer/sdk": minor
---

Add `streams.consume()` async-iterator yielding page batches (`{ events, cursor, tip, reorgs }`, configurable `intervalMs` tip polling, AbortSignal) and make `index.ftTransfers` / `index.nftTransfers` / `index.events` callable as shorthand for `.list()` (`.list`/`.walk` unchanged).
