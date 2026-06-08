---
"@secondlayer/sdk": minor
---

x402 consumer DX: `withX402(fetch, { account })` drop-in (transparently pays on 402) and `createX402Client({ account, baseUrl })` (`.get/.post` returning `{ data, payment }`). Auto-resolves the payer nonce, selects an offer by `preferAssets` (sBTC-first default) with a `maxAmountPerCall` spend guard (`X402SpendGuardError` when nothing fits), and exposes the settlement receipt via `readX402Receipt`. All re-exported from `@secondlayer/sdk` (no longer subpath-only). See `docs/guides/x402-pay-per-call.md`.
