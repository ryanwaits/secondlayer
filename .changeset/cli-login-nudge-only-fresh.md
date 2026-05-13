---
"@secondlayer/cli": patch
---

`sl login` now only shows the new-user walkthrough for accounts that don't have a tenant yet. Returning users (anyone already provisioned) see the original `Run 'sl whoami' to see your account status.` line — no extra noise on every login. The 5.1.4 patch was over-eager and printed nudges to returning users too; this restores prior behavior for them while keeping the helpful 4-step block for genuinely first-time signups.
