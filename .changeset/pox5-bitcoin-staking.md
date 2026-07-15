---
"@secondlayer/stacks": minor
---

PoX-5 Bitcoin Staking (SIP-045) — new `@secondlayer/stacks/pox5` module, pinned against the final contract in stacks-core 4.0.0 (Epoch 4.0 activates at Bitcoin block 960,230, ~2026-07-29).

- `pox5()` client extension: 13 wallet actions (`setupBond`, `registerForBond` with sBTC or proven-L1-lockup paths, `stake`, `stakeUpdate`, `unstake`, `unstakeSbtc`, `announceL1EarlyExit`, rewards, signer grants) that inherit fee tiers, nonce management, and typed broadcast errors; 12 curated reads plus `getStakerState()` — a staker's whole position in one batched multicall.
- Chain-reported activation gating: `isActive()` / `getActivation()` read `/v2/pox` `contract_versions` — no hardcoded heights, integrations shippable before the fork.
- Off-chain L1 tooling that works pre-activation: `buildLockupScript` / `buildLockupAddress` (CLTV + early-exit witness script, network-aware p2wsh incl. regtest), SIP-018 signer grants (`computeSignerGrantHash`, `signSignerGrant` in RSV order, `verifySignerGrant`), and cycle/bond-phase math anchored on chain parameters.
- Verification: script and grant-hash ports are byte-compared against the actual pox-5 boot contract read-onlys in Clarinet simnet (Epoch 4.0), and every wallet action is pinned against the boot contract interface — name, arity, and argument types — through the real build→sign→broadcast path.
