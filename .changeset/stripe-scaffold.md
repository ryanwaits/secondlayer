---
"@secondlayer/shared": minor
---

Lay Stripe billing foundation on the platform control plane.

- Migration 0049 adds nullable `accounts.stripe_customer_id` with a partial unique index (ignores NULLs so Hobby users stay out of Stripe entirely — customer records materialize on first upgrade).
- New `setStripeCustomerId(accountId, id)` query helper + `stripe_customer_id` on the `Account` type.
- Platform API gains a lazy Stripe SDK singleton (`packages/api/src/lib/stripe.ts`), webhook endpoint (`POST /api/webhooks/stripe`) with raw-body signature verification + audit trail, and session-authed billing routes (`POST /api/billing/upgrade`, `GET /api/billing/portal`) that lazy-create the Stripe customer on first upgrade and return Checkout/Portal URLs.
- Idempotent setup script (`bun run stripe:setup` in `@secondlayer/api`) upserts one "Secondlayer" product, a Pro monthly price (`$25/mo`, lookup_key `secondlayer_pro_monthly`), and billing meters + metered prices for compute hours, storage GB-months, and AI eval overages. Enterprise remains custom-quoted per deal.
- Docker `.env.example` documents the new env surface: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_METER_*`, `STRIPE_PRICE_*_OVERAGE`.
