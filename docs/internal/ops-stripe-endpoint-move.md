# Stripe endpoint move (plan 009)

Prod billing is `POST https://api.secondlayer.tools/api/billing/stripe`.
`/api/webhooks/stripe` is 404.

## Account

Hosted API uses the **Secondlayer** Stripe account (`acct_1IDYttEJO9zkTaMJ`,
`sk_live`). The local Stripe CLI default profile is **Waits Technologies**
(`acct_1RxoozBAmshdYT8u`) — a different account. CLI `--live` against the
default profile will not list or mutate prod webhooks. The CLI live key is
`rk_live` without `webhook_write`; create/disable on prod from the box
with `STRIPE_SECRET_KEY`, or in the Secondlayer dashboard.

## Live endpoint (done 2026-09-13)

- Enabled: `we_1UFRNoEJO9zkTaMJiOqlOXru` → `/api/billing/stripe`
  (events: `checkout.session.completed`, `payment_intent.succeeded`, plus
  leftover subscription types the handler acks 2xx).
- Disabled: `we_1TizatEJO9zkTaMJDTIbPc8J` → old `/api/webhooks/stripe`.
- Signing secret was rotated into `/opt/secondlayer/docker/.env` and API
  replicas recreated. Stripe only reveals `whsec_` at create time.

## If you must move it again

Prefer **update URL in place** so the signing secret stays put:

```
# on app-server, using the prod sk_live
POST /v1/webhook_endpoints/we_…  url=https://api.secondlayer.tools/api/billing/stripe
```

Creating a new endpoint requires writing the new `STRIPE_WEBHOOK_SECRET`
into `.env` and `docker compose … up -d --no-deps --force-recreate api`.

## Service rename

On the prod box, `docker compose up -d --remove-orphans` so the old
`subscription-processor` container is removed. `ROLLBACK_SERVICE=webhook-processor`
is the new rollback name. The old ghcr image tags remain pullable but are
no longer built.
