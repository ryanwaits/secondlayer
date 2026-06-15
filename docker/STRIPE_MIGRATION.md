# Stripe go-live — verify the Second Layer account as Waits Technologies LLC

We bill on the existing **Second Layer** Stripe account (`acct_1IDYtt…`, CLI profile
`default`) — where all the integration already lives — and **verify it in place as
Waits Technologies LLC** (EIN), branded customer-facing as **Secondlayer** (DBA). No
account migration: keys, products, webhooks, and customers stay put.

## Why not the standalone "Waits Technologies" Stripe account

That account (`acct_1Rxooz…`) is verified, but as an **individual** (legal name *Samuel
Waits*, SSN — not an EIN), and its tax details warn that legal-identity changes cascade to
other linked accounts (e.g. Texas Sports Academy). It is not the LLC and isn't worth
converting. The Second Layer account is unverified, so we set the legal entity correctly
**at activation** (Company / LLC + EIN) with no cascade and no locked-entity problem — and
skip any migration since the app already runs on it.

## Why this is cheap

The integration is fully env-driven; nothing about the Stripe account is hardcoded:

- Keys + webhook secret: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (env).
- Tier price ids: `STRIPE_PRICE_LAUNCH{,_YEARLY}`, `STRIPE_PRICE_SCALE{,_YEARLY}` (env),
  resolved in `packages/api/src/lib/tier-mapping.ts`.
- The whole Stripe catalog is **1 product + 4 tier prices**, produced idempotently by
  `packages/api/scripts/stripe-setup.ts`.

**No metered storage / overage.** Those were never wired — `STRIPE_METER_STORAGE` and
`STRIPE_PRICE_STORAGE_OVERAGE` have been removed as dead env. No Stripe meter events are
ever pushed. PAYG settles two ways, neither needing extra Stripe catalog setup:

- **Tier subscriptions** — `mode: "subscription"` with the 4 pre-created tier price ids.
- **PAYG credit top-ups** — `mode: "payment"` with **inline `price_data`**
  (`packages/api/src/routes/billing.ts`); the charge credits an internal `account_credits`
  ledger and read metering debits that balance in our DB. Zero Stripe price ids required.

Webhook events the handler processes (`packages/api/src/routes/webhooks-stripe.ts`):
`checkout.session.completed`, `customer.subscription.{created,updated,deleted}`,
`invoice.paid`.

## Steps

### 1. Verify the account as Waits Technologies LLC (dashboard)

On `acct_1IDYtt…` → complete **Activate your account**:
- Type of business → **Company** → LLC (single- or multi-member, matching the IRS filing).
- Legal name → **Waits Technologies**, Tax ID → the LLC's **EIN**.
- Business representative + owners → as filed.
- Link a **bank account in Waits Technologies' name** (payouts follow the legal entity).

### 2. Brand as Secondlayer (dashboard)

Legal entity stays Waits Technologies LLC; only the customer-facing fields change:
- Settings → Business → Business details → **Public business name** → `Secondlayer`.
- Public details → **Business name** → `Secondlayer`; support email / URL.
- **Statement descriptor** → `SECONDLAYER` (≤22 chars).
- Settings → Branding → Secondlayer logo/colors (Checkout, portal, invoices, emails).

### 3. Catalog + webhook (scripted)

The CLI is already authed to the `default` profile.

```sh
# test mode (default), against the "default" profile (Second Layer):
docker/scripts/stripe-migrate.sh

# live cutover (CLI masks live keys, so pass one explicitly):
LIVE=1 STRIPE_SECRET_KEY=rk_live_<secondlayer> docker/scripts/stripe-migrate.sh
```

It upserts the product + 4 tier prices, archives the dead overage price, ensures the
webhook endpoint, and prints the `STRIPE_SECRET_KEY` / `STRIPE_PRICE_*` /
`STRIPE_WEBHOOK_SECRET` block to paste into deploy secrets.

### 4. Re-test, then go live

- **Test round-trip**: checkout → trial → resolve → portal → webhooks, plus a PAYG credit
  top-up.
- **Go live**: once verification clears, rerun the script with `LIVE=1` + the live key,
  then swap the printed live keys / price ids / webhook secret into prod deploy secrets.

## Note on the standalone Waits Technologies account

`acct_1Rxooz…` (individual) and the test-mode catalog/webhook set up on it during scoping
are unused — leave it dormant. Billing stays on the Second Layer account.
