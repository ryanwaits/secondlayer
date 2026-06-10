import type { Database } from "./types.ts";

export type DbPlane = "source" | "target" | "both";

/**
 * Canonical table → DB-plane mapping for the source/target split.
 *
 * SOURCE = chain + decoded (the `postgres` instance); TARGET = control plane
 * (the `postgres-platform` instance). `both` = present/used on both planes
 * (`service_heartbeats`: the indexer writes its row on SOURCE, the
 * subgraph-processor writes its row on TARGET).
 *
 * `satisfies Record<keyof Database, DbPlane>` makes adding a table to `Database`
 * without classifying it here a COMPILE error. This is the single source of
 * truth for the split — `docker/SCHEMA_SPLIT.md` and the cutover script's
 * `CONTROL_TABLES` mirror the `target` set (guarded by `table-plane.test.ts`).
 * Use it to decide which migration helper a table's DDL belongs in
 * (`onControlPlane` for `target`, `onChainPlane` for `source`).
 *
 * Note: `kysely_migration` / `kysely_migration_lock` are kysely-managed (not in
 * `Database`) and exist on both — they are intentionally not listed here.
 */
export const TABLE_TO_DB = {
	// ── SOURCE: raw chain ──
	blocks: "source",
	transactions: "source",
	events: "source",
	transactions_archive: "source",
	events_archive: "source",
	dead_letter_events: "source",
	mempool_transactions: "source",
	index_progress: "source",
	contracts: "source",
	chain_reorgs: "source",
	// ── SOURCE: decoded (L2) ──
	decoded_events: "source",
	l2_decoder_checkpoints: "source",
	pox4_calls: "source",
	pox4_cycles_daily: "source",
	pox4_signers_daily: "source",
	burn_block_rewards: "source",
	burn_block_reward_slots: "source",
	sbtc_events: "source",
	sbtc_token_events: "source",
	sbtc_supply_snapshots: "source",
	bns_name_events: "source",
	bns_namespace_events: "source",
	bns_marketplace_events: "source",
	bns_names: "source",
	bns_namespaces: "source",
	// ── TARGET: accounts / auth / billing ──
	accounts: "target",
	api_keys: "target",
	sessions: "target",
	magic_links: "target",
	claim_tokens: "target",
	usage_daily: "target",
	usage_snapshots: "target",
	account_insights: "target",
	account_agent_runs: "target",
	account_spend_caps: "target",
	processed_stripe_events: "target",
	tenants: "target",
	tenant_usage_monthly: "target",
	tenant_compute_addons: "target",
	provisioning_audit_log: "target",
	projects: "target",
	team_members: "target",
	team_invitations: "target",
	chat_sessions: "target",
	chat_messages: "target",
	// ── TARGET: subscriptions ──
	subscriptions: "target",
	subscription_outbox: "target",
	subscription_deliveries: "target",
	trigger_evaluator_state: "target",
	// ── TARGET: subgraphs + metadata ──
	subgraphs: "target",
	subgraph_operations: "target",
	subgraph_health_snapshots: "target",
	subgraph_gaps: "target",
	subgraph_usage_daily: "target",
	subgraph_processing_stats: "target",
	subgraph_table_snapshots: "target",
	// ── TARGET: x402 payment rail ──
	x402_payments: "target",
	// ── BOTH ──
	service_heartbeats: "both",
} satisfies Record<keyof Database, DbPlane>;
