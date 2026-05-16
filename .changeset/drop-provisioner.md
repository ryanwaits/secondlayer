---
"@secondlayer/api": minor
---

Delete the dedicated-provisioning surface: `/api/tenants` routes, `provisioner-client`, `ephemeral-jwt` minting, `dedicatedAuth` JWT middleware, and the post-stripe-webhook tenant suspend block. The `@secondlayer/provisioner` package is removed from the workspace. Subgraphs + subscriptions are served from the shared platform; per-tenant containers, JWTs, and the tenant lifecycle UI have no remaining call sites.
