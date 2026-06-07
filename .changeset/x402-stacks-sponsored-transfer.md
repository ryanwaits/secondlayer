---
"@secondlayer/stacks": minor
---

Add `@secondlayer/stacks/x402` settlement primitives for the x402 payment rail: `buildExactTransfer` (exact-amount, Deny-mode post-conditioned, sponsored origin-only transfer for STX or SIP-010, challenge nonce bound to the ≤34-byte memo) and `sponsorAndBroadcast` (sponsor-sign a payer's origin-signed tx and POST it to `/v2/transactions`, so the payer never holds STX).
