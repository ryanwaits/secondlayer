---
"@secondlayer/cli": patch
---

post-login next-step nudge. After `sl login` succeeds, the CLI now inspects provisioning state (active project in cwd, tenant on account) and prints a tailored block — fresh accounts see the full 4-step path (`sl project create` → `sl instance create` → `sl subgraphs new` → `sl subgraphs deploy`), users with an instance but no project bound get `sl project use <slug>`, etc. Returning users with a fully-set-up account see only `✓ Logged in` plus a one-line "try this next" suggestion. We deliberately don't auto-provision (Launch is $99/mo; plan choice is the user's call), but a fresh user no longer has to read docs to find the next command. 404 from `/api/tenants/me` is treated as the expected "no tenant yet" state rather than a failure.
