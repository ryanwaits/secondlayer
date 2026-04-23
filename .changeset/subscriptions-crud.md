---
"@secondlayer/sdk": minor
"@secondlayer/shared": minor
---

Subscriptions CRUD surface — new `sl.subscriptions.*` client plus the DB schema + query helpers that back it.

- SDK: `sl.subscriptions.create/list/get/update/delete/rotateSecret/pause/resume` with `CreateSubscriptionResponse` returning a one-time `signingSecret`.
- Shared: Migration `0057_subscriptions` creates `subscriptions` + `subscription_outbox` + `subscription_deliveries` with the `subscriptions:new_outbox` notify trigger. Kysely types for all three tables. New `standard-webhooks` signing helper (matches Svix reference vectors). Subscription queries with encrypted signing secrets (reuses `crypto/secrets`).
- OSS bootstrap: `SECONDLAYER_SECRETS_KEY` autogenerates to `.env.local` on first use when `INSTANCE_MODE=oss`.

No delivery yet — the emitter worker + outbox draining lands Sprint 3. Platform-mode mirror table deferred to a follow-up.
