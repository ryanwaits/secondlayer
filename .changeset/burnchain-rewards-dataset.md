---
"@secondlayer/shared": minor
"@secondlayer/sdk": minor
---

Add the burnchain rewards dataset: Bitcoin PoX reward payouts and reward-set membership, indexed from the stacks-node `/new_burn_block` event. Served at `/v1/datasets/burnchain/rewards` (filter by `recipient`) and `/v1/datasets/burnchain/reward-slots` (filter by `holder`), cursor-paginated by burn block height. New SDK clients `datasets.burnchainRewards` and `datasets.burnchainRewardSlots` (list/walk), and `sl datasets query burnchain-rewards`. Go-forward only.
