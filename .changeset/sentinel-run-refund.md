---
"@secondlayer/api": patch
---

`/internal/sentinel/accounts/grant` accepts `sentinel:refund:<runId>` (`aud_<hex>`) to refund a wrongly charged Sentinel run. Idempotent on the key, labelled `sentinel:refund`, outside the $10 starter total, and capped per refund at the largest Sentinel unit price.
