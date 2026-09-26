---
"@secondlayer/subgraphs": patch
---

`stopEmitter()` now waits for the current claim pass and every in-flight delivery to finish (bounded by the webhook timeout ceiling + 5s) before resolving, instead of returning immediately. Closes the race where a mid-flight POST wrote its `webhook_deliveries` row after the emitter reported "stopped" — a delivery-during-restart hazard in prod. Rows still claimed at the deadline keep their lock and are re-claimed by the next emitter.
