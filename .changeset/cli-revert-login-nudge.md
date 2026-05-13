---
"@secondlayer/cli": patch
---

`sl login` reverts to the pre-5.1.4 message for everyone — `✓ Logged in` plus `Run 'sl whoami' to see your account status.` No tenant probe, no conditional walkthrough. Fresh users still get clear guidance from `sl whoami` and from contextual errors when they run commands without a tenant.
