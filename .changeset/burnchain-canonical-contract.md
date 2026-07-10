---
"@secondlayer/shared": minor
---

Burnchain reward tables drop the vestigial `canonical` column (migration 0107). Replace-per-height is now the documented reorg contract for `burn_block_rewards` / `burn_block_reward_slots`, and `sl index codegen` no longer emits `canonical` for them — if you generated a BYO-mirror schema containing these tables, re-run codegen and drop the column from your mirror (it was never set false, so no data is lost). The contracts registry canonical contract is now enforced: a reorg flips `contracts` rows at/above the fork height non-canonical (re-canonicalized automatically when the deploy is re-discovered on the new fork), and `getContract` / `GET /v1/contracts/:contractId` no longer serve reorged-out contracts.
