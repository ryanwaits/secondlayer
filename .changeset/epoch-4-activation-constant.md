---
"@secondlayer/stacks": minor
---

Add `EPOCH_4_ACTIVATION_BURN_HEIGHT_MAINNET` (Bitcoin burn block 960,230) in a new `epochs.ts`, re-exported from `@secondlayer/stacks/bitcoin`. Epoch 4.0 carries both SIP-044 (the native Bitcoin SPV built-ins / Clarity 6) and SIP-045 (`pox-5` Bitcoin Staking) — one fork, one height — so the bitcoin and pox5 modules now resolve it from a single constant instead of each carrying their own. Only mainnet has a fixed height; on other networks read it from the node (`getPox5Activation`) or pass it explicitly.
