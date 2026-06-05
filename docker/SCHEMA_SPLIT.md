# Database split: SOURCE vs TARGET

Isolates the chain plane (write-heavy, reconstructable, hundreds of GB) from the
control plane (small, must-never-lose) into two Postgres instances, so neither
can starve or take down the other. **Not** a scaling mechanism — that's read
replicas. See `ARCHITECTURE.md`.

Resolution (already wired in `@secondlayer/shared/db`):
- `getSourceDb()` → `SOURCE_DATABASE_URL || DATABASE_URL`
- `getTargetDb()` → `TARGET_DATABASE_URL || DATABASE_URL` (`getDb()` aliases this)

When only `DATABASE_URL` is set both resolve to one DB — the split is a no-op,
so all of this is safe to merge and deploy before any cutover.

## SOURCE (chain + decoded)

Written by the `indexer` and `l2-decoder` services. Read by the public API.

- Raw chain: `blocks`, `transactions`, `events`, `transactions_archive`,
  `events_archive`, `mempool_transactions`, `dead_letter_events`,
  `index_progress`, `contracts`, `chain_reorgs`, `service_heartbeats`
- Decoded (L2): `decoded_events`, `l2_decoder_checkpoints`, `pox4_calls`,
  `pox4_cycles_daily`, `pox4_signers_daily`, `burn_block_rewards`,
  `burn_block_reward_slots`, `sbtc_events`, `sbtc_token_events`,
  `sbtc_supply_snapshots`, `bns_name_events`, `bns_namespace_events`,
  `bns_marketplace_events`, `bns_names`, `bns_namespaces`

Decoded tables live on SOURCE (not TARGET): they are chain-derived, written by
the decode pipeline, and the API already reads them via `getSourceDb()`. Keeping
them on SOURCE avoids cross-DB reads.

## TARGET (control plane)

Written by `api`, `worker`, `subgraph-processor`.

- Accounts/auth/billing: `accounts`, `api_keys`, `sessions`, `magic_links`,
  `usage_daily`, `usage_snapshots`, `account_insights`, `account_agent_runs`,
  `processed_stripe_events`, `tenants`, `tenant_usage_monthly`,
  `tenant_compute_addons`, `account_spend_caps`, `provisioning_audit_log`,
  `subscriptions`, `subscription_outbox`, `subscription_deliveries`,
  `trigger_evaluator_state`, `projects`, `team_members`, `team_invitations`,
  `chat_sessions`, `chat_messages`
- Subgraphs + per-tenant schemas: `subgraphs`, `subgraph_*`

## Migration order (critical)

1. Reroute chain/decoded **writes** to `getSourceDb()` and deploy — single-DB,
   zero behavior change. (G4-S1)
2. Dual-DB migrate + `postgres-platform` container + `assertDbSplit` guard,
   gated behind `SOURCE_/TARGET_DATABASE_URL`. (G4-S2)
3. Cutover: snapshot, move the small control-plane tables to TARGET, flip env.
   (G4-S3 runbook — manual, founder-driven)

Reversed order silently writes chain data to the wrong DB. Never run `migrate`
against the chain instance via `docker compose run` (recreates the volume).
