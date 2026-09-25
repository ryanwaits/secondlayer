---
"@secondlayer/sdk": minor
---

Webhook diagnosis moved from the CLI into the SDK: `buildDoctorReport`, `isSuccessDelivery`, `DoctorReport`, `DoctorIssue`, and `DoctorIssueCode` are now exported from `@secondlayer/sdk`. `DoctorReport` gains a structured `issues: DoctorIssue[]` array alongside the existing `hints: string[]`, so a caller other than the CLI (the dashboard) can build its own copy from the same judgment instead of parsing CLI-command hint strings.

Also published as `@secondlayer/sdk/webhooks/doctor` — the same exports, but from a module with no runtime dependency on `@secondlayer/shared` (types only), so a browser bundle can import the real diagnosis logic without pulling in `@secondlayer/shared`'s Postgres client.
