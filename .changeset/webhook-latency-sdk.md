---
"@secondlayer/sdk": minor
---

`streamsClient.events.consume()` takes an optional `wake: () => Promise<void>` — on an empty page, the loop races the usual `emptyBackoffMs` sleep against it instead of always sleeping the full backoff. A `wake` that never resolves, rejects, or isn't supplied degrades to exactly the old polling behavior.
