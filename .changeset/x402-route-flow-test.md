---
"@secondlayer/api": patch
---

Make the Streams/Index routers mount x402 via an injected, pre-built middleware (`opts.x402Middleware`) instead of reading env + building the facilitator inside the route. The enable/which-facilitator decision now lives at the app composition root (the default export), keeping the route factories pure and env-free; tests inject a fake-backed middleware. Adds a route-integration test driving an accountless request through the real Index router end to end: no-key → 402 challenge → real signed sponsored payment → real `verifyPayment` → settle → real handler returns data, plus ledger write and replay rejection.
