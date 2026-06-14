---
"@secondlayer/shared": minor
"@secondlayer/subgraphs": minor
"@secondlayer/api": minor
---

Add sBTC webhook trigger types and PoX reward-cycle aggregates.

**shared**: 4 new `ChainTrigger` discriminated union members — `sbtc_deposit`, `sbtc_withdrawal_create`, `sbtc_withdrawal_accept`, `sbtc_withdrawal_reject` — each with typed filter schemas. New `SbtcDepositEvent` and `SbtcWithdrawalEvent` envelope interfaces exported from `chain-envelopes`.

**subgraphs**: Trigger evaluator now processes sBTC events from `sbtc_events` table (separate query path from `decoded_events`). `emitSbtcOutbox` matches active chain subscriptions against canonical sBTC events per block and writes to `subscription_outbox`.

**api**: `/v1/index/pox/cycles` and `/v1/index/pox/cycles/:reward_cycle` — paginated PoX-4 reward-cycle aggregates (total ustx locked, unique stackers/delegators, per-function breakdown, `is_current` flag). 30s cache for current cycle, 1h for completed.
