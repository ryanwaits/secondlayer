# Stripe endpoint move (plan 009)

Before deploying the commit that lands 009 step 5, add `https://api.secondlayer.tools/api/billing/stripe` as a second endpoint in the Stripe dashboard with the same events; after deploy, disable the old `/api/webhooks/stripe` endpoint.

## Service rename

On the prod box, after `git pull`, `docker compose up -d --remove-orphans` so the old `subscription-processor` container is removed. `ROLLBACK_SERVICE=webhook-processor` is the new rollback name. The old ghcr image tags remain pullable but are no longer built.
