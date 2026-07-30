---
"@secondlayer/shared": minor
---

Chain-integrity additions behind a production incident on 2026-07-30.

`findBrokenLinks(db)` reports canonical heights whose block does not descend from the canonical block below it. `findGaps` only ever asked "is every height present?", which a chain sitting on a losing fork answers yes to — every height existed, the chain simply did not join up, and nothing asked that question. It went unnoticed for seventeen hours.

New `pending_fork_blocks` table (migration 0112): blocks that arrive claiming a height we already hold, staged until a later block names one of the two as its parent. The node's event observer emits competing blocks at the same height as a matter of course, so a hash mismatch alone cannot tell a real reorg from a sibling about to lose — and adopting on sight picked the wrong side twice in one week.
