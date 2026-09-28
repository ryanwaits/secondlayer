---
"@secondlayer/api": minor
"@secondlayer/sdk": major
"@secondlayer/web": patch
---

`/v1/index/pox/cycles` now reports reward cycles of the current PoX (PoX-5) instead of the retired PoX-4 rollup. Each cycle carries total stacked and reward-eligible STX, bond sats, sBTC custodied, rewards allocated/claimed, cumulative rewards-per-token, and `is_current`/`is_frozen`; the single-cycle route adds a per-signer breakdown. A `pox_version` field marks the era. PoX-4 cycle history is final and not served here.

`sl.index.pox.cycles` picks up the new shape (an SDK major): `unique_stackers`, `unique_delegators`, `action_count`, and `function_breakdown` are gone.
