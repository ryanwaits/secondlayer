---
"@secondlayer/shared": patch
---

Index and Streams reads refused with 402 `spend_cap_reached` or `insufficient_credits` raise `BillingPausedError` and are not retried.
