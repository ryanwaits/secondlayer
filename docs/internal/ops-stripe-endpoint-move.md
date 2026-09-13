# Stripe endpoint move (plan 009)

Before deploying the commit that lands 009 step 5, add `https://api.secondlayer.tools/api/billing/stripe` as a second endpoint in the Stripe dashboard with the same events; after deploy, disable the old `/api/webhooks/stripe` endpoint.
