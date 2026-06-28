---
"@secondlayer/shared": minor
"@secondlayer/subgraphs": minor
---

Add the `sbtc_withdrawal_swept_confirmed` webhook: fires once when a peg-out's committed BTC sweep crosses the confirmation threshold on Bitcoin. New `t.sbtcWithdrawalSweptConfirmed()` trigger + `SbtcWithdrawalSweptConfirmedEvent` payload, emitted by a scan-based evaluator path (`emitSbtcSettlementOutbox`) on its own `last_settlement_scan_at` cursor — forward-only (`confirmed_at > sub.created_at`), idempotent via the outbox dedup key (no double-fire on a reorg→un-confirm→re-confirm).
