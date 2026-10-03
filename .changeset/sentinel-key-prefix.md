---
"@secondlayer/api": patch
---

Sentinel keys are minted with their own `sk-snt_` prefix (existing `sk-sl_` Sentinel keys keep resolving), and `/internal/sentinel/tokens/resolve` answers `404 { error: "other_product" }` for an active key of another product, so Sentinel can tell the caller to use a Sentinel key.
