---
"@secondlayer/api": minor
---

Add the archive fetch gate: `POST /api/archive/quote` (free price preview) and `POST /api/archive/fetch` (charges credits, returns presigned R2 URLs). Pricing derives the dataset from the R2 object key server-side — never from a client-sent field — so a caller can't underpay by claiming a cheaper dataset. Platform mode only; self-host instances don't mount this router.
