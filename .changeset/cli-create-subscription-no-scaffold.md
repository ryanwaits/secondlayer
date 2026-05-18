---
"@secondlayer/cli": patch
---

`sl create subscription` accepts `--no-scaffold` to skip copying the runtime template directory into cwd. The subscription is still provisioned via API and the signing secret is printed to stdout for the user to store. Useful for webhook-only setups (e.g. forwarding to an existing receiver, QA scripts, or webhook.site) where the runtime template is just noise.
