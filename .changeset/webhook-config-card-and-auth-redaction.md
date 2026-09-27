---
"@secondlayer/sdk": major
"@secondlayer/shared": minor
"@secondlayer/api": patch
"@secondlayer/cli": major
"@secondlayer/web": minor
---

Receiver credentials (bearer token, basic auth, custom headers) are now write-only. A webhook read (`GET`, create, update, pause, resume, rotate-secret) returns `auth: { type, headerNames, hasSecret }` instead of `authConfig`, so the credential itself is never echoed back through the API, SDK, or CLI. `authConfig` is unchanged on create and update — this only affects what comes back. `secondlayer webhooks get` prints an `Auth` line (e.g. "bearer token (set, hidden), headers: x-team") in place of the old raw JSON dump.

The dashboard's webhook detail page gets a new Configuration side card: a plain-English read of what a webhook fires on (per-trigger match volume, field-by-field conditions, a warning when an unfiltered trigger is matching — and billing — every event of its type) and where it delivers, plus the config as the CLI/SDK send it. The page also gets a summary line and an always-visible warning for unfiltered triggers. The deliveries table adds an Event column (short tx + event index) so otherwise-identical rows from one block are easy to tell apart, and `GET /:id/activity` adds `byEventType` (7-day counts per trigger/table).

Fixes two delivery-card bugs: reopening no longer swaps to a different delivery when a 10s poll reshuffles the table underneath it, and a tall Response body no longer squashes the tab row to zero height.
