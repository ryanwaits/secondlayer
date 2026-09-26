---
"@secondlayer/sdk": minor
"@secondlayer/shared": patch
"@secondlayer/cli": patch
"@secondlayer/web": minor
---

Webhook doctor now runs five deterministic, numbers-only detectors on top of the existing flag checks: rate-limited, down, rejecting, slow, and running behind on delivery. Every issue carries a `severity`, `evidence` (2-4 facts) and an optional `fix` (text, a copyable CLI command, a docs link); `buildDoctorReport` also returns `primary`, the single most severe issue. `secondlayer webhooks doctor` leads with it; the dashboard's detail page rebuilds `DiagnosisPanel` as an insight card with an evidence list and a "how we worked this out" disclosure. The webhooks list shows a one-line, dismissible note per row (paused or circuit-tripped) computed from data it already has, with a once-per-webhook toast for bad/warn cases. `/account/credits` adds a runway estimate and a free-rows heads-up, both numbers only. `WebhookSummary` now types `circuitOpenedAt` (the API already returned it). No model, no history beyond the deliveries window already fetched.
