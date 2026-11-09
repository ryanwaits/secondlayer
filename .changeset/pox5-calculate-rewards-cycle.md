---
"@secondlayer/shared": patch
---

`calculate-rewards` rows in `pox5_events` carry `reward_cycle` (from the print's `stx-cycle`), so `/v1/index/pox5/events?reward_cycle=` finds them. Migration 0208 fills existing rows from the stored `data`.
