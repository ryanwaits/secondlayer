---
"@secondlayer/shared": minor
---

Remove account/billing modules from the public surface — db/queries (accounts, usage, account-spend-caps, projects) and schemas/accounts, relocated to an internal package. The schemas barrel no longer re-exports account schemas.
