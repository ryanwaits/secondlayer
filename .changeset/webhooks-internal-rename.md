---
"@secondlayer/shared": minor
"@secondlayer/subgraphs": minor
"@secondlayer/api": minor
"@secondlayer/worker": minor
---

The subscription plane is now the webhook plane: tables, types, service and image names renamed. Migration 0126 renames tables in place (no data copy). Migration 0127 renames the leftover auto-generated constraint names (`subscriptions_pkey` and kin). The compose service is `webhook-processor`; the Stripe receiver moved to `/api/billing/stripe`. Public CLI/SDK/MCP names follow in the next release.
