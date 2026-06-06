---
"@secondlayer/cli": patch
---

`sl subscriptions test --post` now sends the test delivery via the server endpoint (built for the real format, SSRF-guarded, and logged under deliveries) instead of a client-side standard-webhooks-only POST. Use `--post --local` for the previous client-side behavior.
