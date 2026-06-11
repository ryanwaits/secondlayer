import type {
	ColumnType,
	Generated,
	Insertable,
	Selectable,
	Updateable,
} from "kysely";

// ── Table interfaces ──────────────────────────────────────────────────

export interface BlocksTable {
	height: number;
	hash: string;
	parent_hash: string;
	burn_block_height: number;
	burn_block_hash: ColumnType<
		string | null,
		string | null | undefined,
		string | null
	>;
	/** Nakamoto StacksBlockId. Null on rows ingested before it was persisted. */
	index_block_hash: ColumnType<
		string | null,
		string | null | undefined,
		string | null
	>;
	timestamp: number;
	canonical: Generated<boolean>;
	created_at: Generated<Date>;
}

export interface TransactionsTable {
	tx_id: string;
	block_height: number;
	tx_index: Generated<number>;
	type: string;
	sender: string;
	status: string;
	contract_id: string | null;
	function_name: string | null;
	function_args: Generated<unknown | null>;
	raw_result: Generated<string | null>;
	raw_tx: string;
	created_at: Generated<Date>;
}

export interface EventsTable {
	id: Generated<string>;
	tx_id: string;
	block_height: number;
	event_index: number;
	type: string;
	data: unknown;
	created_at: Generated<Date>;
}

// Reorg archive (see migration 0084): orphaned transactions/events copied here
// before a reused height is replaced, preserving the raw log instead of
// deleting it.
export interface TransactionsArchiveTable {
	archive_id: Generated<string>;
	tx_id: string;
	block_height: number;
	tx_index: number;
	type: string;
	sender: string;
	status: string;
	contract_id: string | null;
	function_name: string | null;
	function_args: unknown | null;
	raw_result: string | null;
	raw_tx: string;
	created_at: Date;
	orphaned_block_hash: string | null;
	archived_at: Generated<Date>;
}

export interface EventsArchiveTable {
	archive_id: Generated<string>;
	id: string;
	tx_id: string;
	block_height: number;
	event_index: number;
	type: string;
	data: unknown;
	created_at: Date;
	orphaned_block_hash: string | null;
	archived_at: Generated<Date>;
}

// Dead-letter log (see migration 0085): events whose decoded payload failed
// schema validation on ingest. Append-only diagnostic; the event still lands in
// `events`, so chain data is never lost.
export interface DeadLetterEventsTable {
	id: Generated<string>;
	block_height: number;
	tx_id: string;
	event_index: number;
	event_type: string;
	data: unknown;
	reason: string;
	created_at: Generated<Date>;
}

// Pending (unconfirmed) transactions (see migration 0086). Pre-chain, so no
// block_height/tx_index/result/events and never canonical. tx_id is derived
// from raw_tx; function_args holds hex-encoded ClarityValues (jsonb), like
// `transactions`.
export interface MempoolTransactionsTable {
	seq: Generated<string>;
	tx_id: string;
	raw_tx: string;
	type: string;
	sender: string;
	contract_id: string | null;
	function_name: string | null;
	function_args: unknown | null;
	received_at: Generated<Date>;
}

export interface IndexProgressTable {
	network: string;
	last_indexed_block: Generated<number>;
	last_contiguous_block: Generated<number>;
	highest_seen_block: Generated<number>;
	updated_at: Generated<Date>;
}

export interface SubgraphsTable {
	id: Generated<string>;
	name: string;
	version: Generated<string>;
	status: Generated<string>;
	definition: Record<string, unknown>;
	schema_hash: string;
	handler_path: string;
	schema_name: string | null;
	start_block: Generated<number>;
	last_processed_block: Generated<number>;
	reindex_from_block: number | null;
	reindex_to_block: number | null;
	last_error: string | null;
	last_error_at: Date | null;
	total_processed: Generated<number>;
	total_errors: Generated<number>;
	account_id: string;
	handler_code: string | null;
	source_code: string | null;
	project_id: string | null;
	// 'public' = anon-readable via /v1/subgraphs (global name namespace,
	// claim-on-publish); 'private' = reads require the owning account's key.
	visibility: Generated<string>;
	/** Paid (wallet-ghost) deploys expire unless renewed or claimed; NULL = no expiry. */
	expires_at: Date | null;
	// BYO data plane: AES-GCM envelope (iv‖tag‖ciphertext) of the user-owned
	// Postgres connection string. Null = managed (writes/serving use the target
	// DB). Encrypted via crypto/secrets.ts; never returned in API responses.
	database_url_enc: ColumnType<
		Buffer | null,
		Buffer | null | undefined,
		Buffer | null
	>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface ContractsTable {
	contract_id: string;
	deployer: string;
	block_height: number;
	canonical: Generated<boolean>;
	abi: unknown | null;
	declared_traits: Generated<string[]>;
	inferred_standards: Generated<string[]>;
	abi_status: Generated<string>;
	abi_fetched_at: Date | null;
	created_at: Generated<Date>;
}

export interface SubgraphGapsTable {
	id: Generated<string>;
	subgraph_id: string;
	subgraph_name: string;
	gap_start: number;
	gap_end: number;
	reason: string;
	detected_at: Generated<Date>;
	resolved_at: Date | null;
}

export type SubgraphOperationKind = "reindex" | "backfill";
export type SubgraphOperationStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface SubgraphOperationsTable {
	id: Generated<string>;
	subgraph_id: string;
	subgraph_name: string;
	account_id: string | null;
	kind: ColumnType<
		SubgraphOperationKind,
		SubgraphOperationKind,
		SubgraphOperationKind
	>;
	status: ColumnType<
		SubgraphOperationStatus,
		SubgraphOperationStatus | undefined,
		SubgraphOperationStatus
	>;
	from_block: number | null;
	to_block: number | null;
	cancel_requested: Generated<boolean>;
	locked_by: string | null;
	locked_until: Date | null;
	started_at: Date | null;
	finished_at: Date | null;
	processed_blocks: number | null;
	error: string | null;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface ApiKeysTable {
	id: Generated<string>;
	key_hash: string;
	key_prefix: string;
	name: string | null;
	status: Generated<string>;
	rate_limit: Generated<number>;
	ip_address: string;
	account_id: string;
	product: Generated<"account" | "streams" | "index">;
	tier: "free" | "build" | "scale" | "enterprise" | null;
	last_used_at: Date | null;
	revoked_at: Date | null;
	created_at: Generated<Date>;
}

export interface AccountsTable {
	id: Generated<string>;
	/** NULL for unclaimed ghost accounts (anonymous self-serve keys). */
	email: string | null;
	/** True for anonymous self-serve accounts until claimed via magic link. */
	ghost: Generated<boolean>;
	/** Stacks principal owning a wallet-ghost account (x402-paid deploys). */
	wallet_principal: string | null;
	plan: Generated<string>;
	display_name: string | null;
	bio: string | null;
	avatar_url: string | null;
	slug: string | null;
	stripe_customer_id: string | null;
	created_at: Generated<Date>;
}

export interface SessionsTable {
	id: Generated<string>;
	token_hash: string;
	token_prefix: string;
	account_id: string;
	ip_address: string;
	expires_at: Generated<Date>;
	revoked_at: Date | null;
	last_used_at: Date | null;
	created_at: Generated<Date>;
}

/**
 * One-time claim tokens for ghost accounts. The raw token only ever appears in
 * the claim URL returned at mint time; we store its sha256. A used token marks
 * the account as claimed (or merged into an existing account).
 */
export interface ClaimTokensTable {
	id: Generated<string>;
	account_id: string;
	token_hash: string;
	created_at: Generated<Date>;
	expires_at: Date;
	used_at: Date | null;
}

export interface MagicLinksTable {
	id: Generated<string>;
	email: string;
	token: string;
	code: string | null;
	expires_at: Date;
	used_at: Date | null;
	failed_attempts: Generated<number>;
	created_at: Generated<Date>;
}

export interface UsageDailyTable {
	account_id: string;
	tenant_id: string | null;
	date: string;
	api_requests: Generated<number>;
	deliveries: Generated<number>;
	streams_events_returned: Generated<number>;
	index_decoded_events_returned: Generated<number>;
}

export interface UsageSnapshotsTable {
	id: Generated<string>;
	account_id: string;
	measured_at: Generated<Date>;
	storage_bytes: Generated<number>;
}

export interface AccountInsightsTable {
	id: Generated<string>;
	account_id: string;
	category: string;
	insight_type: string;
	resource_id: string | null;
	severity: string;
	title: string;
	body: string;
	data: unknown;
	dismissed_at: Date | null;
	expires_at: Date | null;
	created_at: Generated<Date>;
}

export interface AccountAgentRunsTable {
	id: Generated<string>;
	account_id: string;
	started_at: Generated<Date>;
	completed_at: Date | null;
	status: Generated<string>;
	input_tokens: Generated<number>;
	output_tokens: Generated<number>;
	cost_usd: Generated<number>;
	insights_created: Generated<number>;
	error: string | null;
}

export interface SubgraphProcessingStatsTable {
	id: Generated<string>;
	subgraph_name: string;
	api_key_id: string | null;
	bucket_start: Date | null;
	bucket_end: Date | null;
	blocks_processed: number | null;
	total_time_ms: number | null;
	handler_time_ms: number | null;
	flush_time_ms: number | null;
	max_block_time_ms: number | null;
	max_handler_time_ms: number | null;
	avg_ops_per_block: number | null;
	is_catchup: Generated<boolean>;
	created_at: Generated<Date>;
}

export interface SubgraphTableSnapshotsTable {
	id: Generated<string>;
	subgraph_name: string;
	api_key_id: string | null;
	table_name: string;
	row_count: number | null;
	created_at: Generated<Date>;
}

export interface SubgraphHealthSnapshotsTable {
	id: Generated<string>;
	subgraph_id: string;
	total_processed: number;
	total_errors: number;
	last_processed_block: number | null;
	captured_at: Generated<Date>;
}

export interface SubgraphUsageDailyTable {
	subgraph_id: string;
	date: string;
	query_count: Generated<number>;
}

export interface ProjectsTable {
	id: Generated<string>;
	name: string;
	slug: string;
	account_id: string;
	settings: Generated<Record<string, unknown>>;
	network: Generated<string>;
	node_rpc: string | null;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface TeamMembersTable {
	id: Generated<string>;
	project_id: string;
	account_id: string;
	role: Generated<string>;
	invited_by: string | null;
	created_at: Generated<Date>;
}

export interface TeamInvitationsTable {
	id: Generated<string>;
	project_id: string;
	email: string;
	role: Generated<string>;
	token: string;
	invited_by: string | null;
	expires_at: Date;
	accepted_at: Date | null;
	created_at: Generated<Date>;
}

export interface ProcessedStripeEventsTable {
	event_id: string;
	event_type: string;
	processed_at: Generated<Date>;
}

export interface DecodedEventsTable {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: string;
	microblock_hash: string | null;
	canonical: Generated<boolean>;
	contract_id: string | null;
	sender: string | null;
	recipient: string | null;
	amount: string | null;
	asset_identifier: string | null;
	value: string | null;
	memo: string | null;
	/** Decoded payload for event types that don't fit the flat columns
	 *  (e.g. `print`: { topic, value, raw_value }). Null for transfer types. */
	payload: unknown | null;
	source_cursor: string;
	created_at: Generated<Date>;
}

export interface L2DecoderCheckpointsTable {
	decoder_name: string;
	last_cursor: string | null;
	updated_at: Generated<Date>;
}

export interface ChainReorgsTable {
	id: Generated<string>;
	detected_at: Generated<Date>;
	fork_point_height: number;
	old_index_block_hash: string | null;
	new_index_block_hash: string | null;
	orphaned_from_height: number;
	orphaned_from_event_index: number;
	orphaned_to_height: number;
	orphaned_to_event_index: number;
	new_canonical_height: number;
	new_canonical_event_index: number;
	created_at: Generated<Date>;
}

// ── L2 decoded tables: PoX-4 / sBTC / BNS ────────────────────────────

export type Pox4FunctionName =
	| "stack-stx"
	| "delegate-stx"
	| "stack-extend"
	| "stack-increase"
	| "revoke-delegate-stx"
	| "delegate-stack-stx"
	| "delegate-stack-extend"
	| "delegate-stack-increase"
	| "stack-aggregation-commit"
	| "stack-aggregation-commit-indexed"
	| "stack-aggregation-increase"
	| "set-signer-key-authorization";

export interface Pox4CallsTable {
	cursor: string;
	block_height: number;
	block_time: Date;
	burn_block_height: number;
	tx_id: string;
	tx_index: number;
	function_name: Pox4FunctionName;
	caller: string;
	stacker: string | null;
	delegate_to: string | null;
	amount_ustx: string | null;
	lock_period: number | null;
	pox_addr_version: number | null;
	pox_addr_hashbytes: string | null;
	pox_addr_btc: string | null;
	start_cycle: number | null;
	end_cycle: number | null;
	signer_key: string | null;
	signer_signature: string | null;
	auth_id: string | null;
	max_amount: string | null;
	reward_cycle: number | null;
	aggregated_amount_ustx: string | null;
	aggregated_signer_index: number | null;
	auth_period: number | null;
	auth_topic: string | null;
	auth_allowed: boolean | null;
	result_ok: boolean;
	result_raw: string;
	canonical: Generated<boolean>;
	source_cursor: string;
	created_at: Generated<Date>;
}

export interface Pox4CyclesDailyTable {
	date: string;
	reward_cycle: number;
	total_stacked_ustx: Generated<string>;
	solo_stackers: Generated<number>;
	delegated_principals: Generated<number>;
	unique_pools: Generated<number>;
	unique_signers: Generated<number>;
	calls_today: Generated<number>;
	updated_at: Generated<Date>;
}

export interface Pox4SignersDailyTable {
	date: string;
	reward_cycle: number;
	signer_key: string;
	weight_ustx: Generated<string>;
	stacker_count: Generated<number>;
	aggregation_calls: Generated<number>;
	updated_at: Generated<Date>;
}

// Actual BTC PoX payout — one row per reward slot (≤2 per burn block), from the
// /new_burn_block reward_recipients array. `amount_sats`/`burn_amount` are sats.
export interface BurnBlockRewardsTable {
	cursor: string;
	burn_block_height: number;
	burn_block_hash: string;
	reward_index: number;
	recipient_btc: string;
	// sats; TEXT to match the dataset amount convention (BIGINT returns as string).
	amount_sats: string;
	burn_amount: Generated<string>;
	canonical: Generated<boolean>;
	created_at: Generated<Date>;
}

// Reward-set membership per burn block, from /new_burn_block reward_slot_holders.
export interface BurnBlockRewardSlotsTable {
	cursor: string;
	burn_block_height: number;
	burn_block_hash: string;
	slot_index: number;
	holder_btc: string;
	canonical: Generated<boolean>;
	created_at: Generated<Date>;
}

export type SbtcEventTopic =
	| "completed-deposit"
	| "withdrawal-create"
	| "withdrawal-accept"
	| "withdrawal-reject"
	| "key-rotation"
	| "update-protocol-contract";

export interface SbtcEventsTable {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: SbtcEventTopic;
	request_id: number | null;
	amount: string | null;
	sender: string | null;
	recipient_btc_version: number | null;
	recipient_btc_hashbytes: string | null;
	bitcoin_txid: string | null;
	output_index: number | null;
	sweep_txid: string | null;
	burn_hash: string | null;
	burn_height: number | null;
	signer_bitmap: string | null;
	max_fee: string | null;
	fee: string | null;
	block_height_at_request: number | null;
	governance_contract_type: number | null;
	governance_new_contract: string | null;
	signer_aggregate_pubkey: string | null;
	signer_threshold: number | null;
	signer_address: string | null;
	signer_keys_count: number | null;
	canonical: Generated<boolean>;
	source_cursor: string;
	created_at: Generated<Date>;
}

export type SbtcTokenEventType = "transfer" | "mint" | "burn";

export interface SbtcTokenEventsTable {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: SbtcTokenEventType;
	sender: string | null;
	recipient: string | null;
	amount: string;
	memo: string | null;
	canonical: Generated<boolean>;
	source_cursor: string;
	created_at: Generated<Date>;
}

export interface SbtcSupplySnapshotsTable {
	date: string;
	total_supply: Generated<string>;
	mints_today: Generated<string>;
	burns_today: Generated<string>;
	deposit_count: Generated<number>;
	withdrawal_create_count: Generated<number>;
	withdrawal_accept_count: Generated<number>;
	withdrawal_reject_count: Generated<number>;
	updated_at: Generated<Date>;
}

export type BnsNameEventTopic =
	| "new-name"
	| "transfer-name"
	| "renew-name"
	| "burn-name"
	| "new-airdrop";

export interface BnsNameEventsTable {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: BnsNameEventTopic;
	namespace: string;
	name: string;
	fqn: string;
	owner: string | null;
	bns_id: string;
	registered_at: number | null;
	imported_at: number | null;
	renewal_height: number | null;
	stx_burn: string | null;
	preordered_by: string | null;
	hashed_salted_fqn_preorder: string | null;
	canonical: Generated<boolean>;
	source_cursor: string;
	created_at: Generated<Date>;
}

export type BnsNamespaceEventStatus =
	| "launch"
	| "transfer-manager"
	| "freeze-manager"
	| "update-price-manager"
	| "freeze-price-manager"
	| "turn-off-manager-transfers";

export interface BnsNamespaceEventsTable {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	status: BnsNamespaceEventStatus;
	namespace: string;
	manager: string | null;
	manager_frozen: boolean | null;
	manager_transfers_disabled: boolean | null;
	price_function: string | null;
	price_frozen: boolean | null;
	lifetime: number | null;
	revealed_at: number | null;
	launched_at: number | null;
	canonical: Generated<boolean>;
	source_cursor: string;
	created_at: Generated<Date>;
}

export type BnsMarketplaceAction =
	| "list-in-ustx"
	| "unlist-in-ustx"
	| "buy-in-ustx";

export interface BnsMarketplaceEventsTable {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	action: BnsMarketplaceAction;
	bns_id: string;
	price_ustx: string | null;
	commission: string | null;
	canonical: Generated<boolean>;
	source_cursor: string;
	created_at: Generated<Date>;
}

export interface BnsNamesTable {
	fqn: string;
	namespace: string;
	name: string;
	owner: string;
	bns_id: string;
	registered_at: number | null;
	renewal_height: number | null;
	last_event_cursor: string;
	last_event_at: Date;
	updated_at: Generated<Date>;
}

export interface BnsNamespacesTable {
	namespace: string;
	manager: string | null;
	manager_frozen: Generated<boolean>;
	price_frozen: Generated<boolean>;
	lifetime: number | null;
	launched_at: number | null;
	last_event_cursor: string;
	last_event_at: Date;
	name_count: Generated<number>;
	updated_at: Generated<Date>;
}

// ── Database interface ────────────────────────────────────────────────

export interface Database {
	blocks: BlocksTable;
	transactions: TransactionsTable;
	events: EventsTable;
	transactions_archive: TransactionsArchiveTable;
	events_archive: EventsArchiveTable;
	dead_letter_events: DeadLetterEventsTable;
	mempool_transactions: MempoolTransactionsTable;
	index_progress: IndexProgressTable;
	contracts: ContractsTable;
	subgraphs: SubgraphsTable;
	api_keys: ApiKeysTable;
	accounts: AccountsTable;
	sessions: SessionsTable;
	magic_links: MagicLinksTable;
	claim_tokens: ClaimTokensTable;
	usage_daily: UsageDailyTable;
	usage_snapshots: UsageSnapshotsTable;
	account_insights: AccountInsightsTable;
	account_agent_runs: AccountAgentRunsTable;
	subgraph_health_snapshots: SubgraphHealthSnapshotsTable;
	subgraph_processing_stats: SubgraphProcessingStatsTable;
	subgraph_table_snapshots: SubgraphTableSnapshotsTable;
	subgraph_gaps: SubgraphGapsTable;
	subgraph_operations: SubgraphOperationsTable;
	subgraph_usage_daily: SubgraphUsageDailyTable;
	projects: ProjectsTable;
	team_members: TeamMembersTable;
	team_invitations: TeamInvitationsTable;
	processed_stripe_events: ProcessedStripeEventsTable;
	tenants: TenantsTable;
	tenant_usage_monthly: TenantUsageMonthlyTable;
	tenant_compute_addons: TenantComputeAddonsTable;
	account_spend_caps: AccountSpendCapsTable;
	provisioning_audit_log: ProvisioningAuditLogTable;
	subscriptions: SubscriptionsTable;
	subscription_outbox: SubscriptionOutboxTable;
	subscription_deliveries: SubscriptionDeliveriesTable;
	trigger_evaluator_state: TriggerEvaluatorStateTable;
	decoded_events: DecodedEventsTable;
	l2_decoder_checkpoints: L2DecoderCheckpointsTable;
	chain_reorgs: ChainReorgsTable;
	pox4_calls: Pox4CallsTable;
	pox4_cycles_daily: Pox4CyclesDailyTable;
	pox4_signers_daily: Pox4SignersDailyTable;
	burn_block_rewards: BurnBlockRewardsTable;
	burn_block_reward_slots: BurnBlockRewardSlotsTable;
	sbtc_events: SbtcEventsTable;
	sbtc_token_events: SbtcTokenEventsTable;
	sbtc_supply_snapshots: SbtcSupplySnapshotsTable;
	bns_name_events: BnsNameEventsTable;
	bns_namespace_events: BnsNamespaceEventsTable;
	bns_marketplace_events: BnsMarketplaceEventsTable;
	bns_names: BnsNamesTable;
	bns_namespaces: BnsNamespacesTable;
	service_heartbeats: ServiceHeartbeatsTable;
	x402_payments: X402PaymentsTable;
	x402_balances: X402BalancesTable;
}

/** Prepaid x402 credit — one running USD-micros balance per payer principal. */
export interface X402BalancesTable {
	principal: string;
	balance_usd_micros: Generated<string | number | bigint>;
	/** Month bucket ("YYYY-MM") the spend counter applies to. */
	spent_month: string | null;
	spent_month_usd_micros: Generated<string | number | bigint>;
	updated_at: Generated<Date>;
}

export interface ServiceHeartbeatsTable {
	name: string;
	updated_at: Generated<Date>;
}

/** x402 pay-per-request ledger (control plane). One row per settled payment,
 *  keyed by challenge nonce + settled txid. `state` tracks confirmed-tier
 *  settlement and post-serve reorg reversal. */
export interface X402PaymentsTable {
	id: Generated<string>;
	nonce: string;
	txid: string;
	asset: string;
	amount: string;
	payer: string;
	surface: string;
	state: Generated<"pending" | "confirmed" | "reverted">;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	/** "payment" = per-call settle; "deposit" = prepaid balance top-up. */
	kind: Generated<string>;
	/** Linked claimed account once the paying wallet is attached (continuity). */
	account_id: string | null;
}

// --- Tenants (dedicated hosting) ---

export type TenantStatus =
	| "provisioning"
	| "active"
	| "limit_warning"
	| "paused_limit"
	| "suspended"
	| "error"
	| "deleted";

export interface TenantsTable {
	id: Generated<string>;
	account_id: string;
	slug: string;
	status: ColumnType<TenantStatus, TenantStatus | undefined, TenantStatus>;
	plan: string;
	cpus: ColumnType<number, number | string, number | string>;
	memory_mb: number;
	storage_limit_mb: number;
	storage_used_mb: number | null;
	pg_container_id: string | null;
	api_container_id: string | null;
	processor_container_id: string | null;
	target_database_url_enc: Buffer;
	tenant_jwt_secret_enc: Buffer;
	anon_key_enc: Buffer;
	service_key_enc: Buffer;
	api_url_internal: string;
	api_url_public: string;
	suspended_at: Date | null;
	last_health_check_at: Date | null;
	last_active_at: Generated<Date>;
	service_gen: Generated<number>;
	anon_gen: Generated<number>;
	project_id: string | null;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export type Tenant = Selectable<TenantsTable>;
export type InsertTenant = Insertable<TenantsTable>;
export type UpdateTenant = Updateable<TenantsTable>;

// --- Tenant monthly usage snapshots (for future billing) ---

export interface TenantUsageMonthlyTable {
	id: Generated<string>;
	tenant_id: string;
	period_month: Date;
	storage_peak_mb: Generated<number>;
	storage_avg_mb: Generated<number>;
	storage_last_mb: Generated<number>;
	measurements: Generated<number>;
	first_at: Generated<Date>;
	last_at: Generated<Date>;
}

export type TenantUsageMonthly = Selectable<TenantUsageMonthlyTable>;
export type InsertTenantUsageMonthly = Insertable<TenantUsageMonthlyTable>;
export type UpdateTenantUsageMonthly = Updateable<TenantUsageMonthlyTable>;

// --- Tenant compute add-ons (Sprint C.1) ---
//
// Compute extras purchased on top of a plan's base spec. Each row = one
// add-on bundle. Effective compute for a tenant = plan base +
// SUM(*_delta columns where effective_until IS NULL OR > now()).

export interface TenantComputeAddonsTable {
	id: Generated<string>;
	tenant_id: string;
	memory_mb_delta: Generated<number>;
	cpu_delta: Generated<number | string>;
	storage_mb_delta: Generated<number>;
	effective_from: Generated<Date>;
	effective_until: Date | null;
	stripe_subscription_item_id: string | null;
	created_at: Generated<Date>;
}

export type TenantComputeAddon = Selectable<TenantComputeAddonsTable>;
export type InsertTenantComputeAddon = Insertable<TenantComputeAddonsTable>;
export type UpdateTenantComputeAddon = Updateable<TenantComputeAddonsTable>;

// --- Account spend caps (soft cap + threshold alerts) ---
//
// One row per account. Null caps = "no cap" for that dimension.
// `frozen_at` is set when a cap is hit; cleared on invoice.paid webhook
// at cycle rollover. While frozen, metering events stop accumulating.

export interface AccountSpendCapsTable {
	account_id: string;
	monthly_cap_cents: number | null;
	compute_cap_cents: number | null;
	storage_cap_cents: number | null;
	alert_threshold_pct: Generated<number>;
	alert_sent_at: Date | null;
	frozen_at: Date | null;
	updated_at: Generated<Date>;
}

export type AccountSpendCap = Selectable<AccountSpendCapsTable>;
export type InsertAccountSpendCap = Insertable<AccountSpendCapsTable>;
export type UpdateAccountSpendCap = Updateable<AccountSpendCapsTable>;

// --- Provisioning audit log ---

export type ProvisioningAuditEvent =
	| "provision.start"
	| "provision.success"
	| "provision.failure"
	| "suspend"
	| "resume"
	| "resize"
	| "keys.rotate"
	| "bastion.key.upload"
	| "bastion.key.revoke"
	| "teardown";

export type ProvisioningAuditStatus = "ok" | "error";

export interface ProvisioningAuditLogTable {
	id: Generated<string>;
	tenant_id: string | null;
	tenant_slug: string | null;
	account_id: string | null;
	actor: string;
	event: ProvisioningAuditEvent;
	status: ProvisioningAuditStatus;
	detail: unknown | null;
	error: string | null;
	created_at: Generated<Date>;
}

export type ProvisioningAuditLog = Selectable<ProvisioningAuditLogTable>;
export type InsertProvisioningAuditLog = Insertable<ProvisioningAuditLogTable>;

// ── Convenience types ─────────────────────────────────────────────────

export type Block = Selectable<BlocksTable>;
export type InsertBlock = Insertable<BlocksTable>;
export type UpdateBlock = Updateable<BlocksTable>;

export type Transaction = Selectable<TransactionsTable>;
export type InsertTransaction = Insertable<TransactionsTable>;
export type UpdateTransaction = Updateable<TransactionsTable>;

export type MempoolTransaction = Selectable<MempoolTransactionsTable>;
export type InsertMempoolTransaction = Insertable<MempoolTransactionsTable>;

export type Event = Selectable<EventsTable>;
export type InsertEvent = Insertable<EventsTable>;
export type UpdateEvent = Updateable<EventsTable>;

export type IndexProgress = Selectable<IndexProgressTable>;
export type InsertIndexProgress = Insertable<IndexProgressTable>;
export type UpdateIndexProgress = Updateable<IndexProgressTable>;

export type Subgraph = Selectable<SubgraphsTable>;
export type InsertSubgraph = Insertable<SubgraphsTable>;
export type UpdateSubgraph = Updateable<SubgraphsTable>;

export type Contract = Selectable<ContractsTable>;
export type InsertContract = Insertable<ContractsTable>;
export type UpdateContract = Updateable<ContractsTable>;

export type SubgraphOperation = Selectable<SubgraphOperationsTable>;
export type InsertSubgraphOperation = Insertable<SubgraphOperationsTable>;
export type UpdateSubgraphOperation = Updateable<SubgraphOperationsTable>;

export type ApiKey = Selectable<ApiKeysTable>;
export type InsertApiKey = Insertable<ApiKeysTable>;
export type UpdateApiKey = Updateable<ApiKeysTable>;

export type Account = Selectable<AccountsTable>;
export type InsertAccount = Insertable<AccountsTable>;

export type MagicLink = Selectable<MagicLinksTable>;
export type InsertMagicLink = Insertable<MagicLinksTable>;

export type ClaimToken = Selectable<ClaimTokensTable>;
export type InsertClaimToken = Insertable<ClaimTokensTable>;

export type Session = Selectable<SessionsTable>;
export type InsertSession = Insertable<SessionsTable>;

export type UsageDaily = Selectable<UsageDailyTable>;
export type UsageSnapshot = Selectable<UsageSnapshotsTable>;

export type AccountInsight = Selectable<AccountInsightsTable>;
export type InsertAccountInsight = Insertable<AccountInsightsTable>;

export type AccountAgentRun = Selectable<AccountAgentRunsTable>;
export type InsertAccountAgentRun = Insertable<AccountAgentRunsTable>;

export type SubgraphHealthSnapshot = Selectable<SubgraphHealthSnapshotsTable>;
export type InsertSubgraphHealthSnapshot =
	Insertable<SubgraphHealthSnapshotsTable>;

export type SubgraphGap = Selectable<SubgraphGapsTable>;
export type InsertSubgraphGap = Insertable<SubgraphGapsTable>;

export type SubgraphUsageDaily = Selectable<SubgraphUsageDailyTable>;
export type InsertSubgraphUsageDaily = Insertable<SubgraphUsageDailyTable>;

export type Project = Selectable<ProjectsTable>;
export type InsertProject = Insertable<ProjectsTable>;
export type UpdateProject = Updateable<ProjectsTable>;

export type TeamMember = Selectable<TeamMembersTable>;
export type InsertTeamMember = Insertable<TeamMembersTable>;

export type TeamInvitation = Selectable<TeamInvitationsTable>;
export type InsertTeamInvitation = Insertable<TeamInvitationsTable>;

// ── Subscriptions (subgraph event subscriptions) ─────────────────────

export type SubscriptionStatus = "active" | "paused" | "error";

/** Polymorphic subscription mode: `subgraph` reacts to processed table rows;
 *  `chain` reacts to raw chain events matched directly off the Index/Streams
 *  clock (no subgraph). See migration 0088. */
export type SubscriptionKind = "subgraph" | "chain";
export type SubscriptionFormat =
	| "standard-webhooks"
	| "inngest"
	| "trigger"
	| "cloudflare"
	| "cloudevents"
	| "raw";
export type SubscriptionRuntime = "inngest" | "trigger" | "cloudflare" | "node";

export interface SubscriptionsTable {
	id: Generated<string>;
	account_id: string;
	project_id: string | null;
	name: string;
	status: ColumnType<
		SubscriptionStatus,
		SubscriptionStatus | undefined,
		SubscriptionStatus
	>;
	kind: ColumnType<
		SubscriptionKind,
		SubscriptionKind | undefined,
		SubscriptionKind
	>;
	/** Null for chain subscriptions (CHECK subscriptions_kind_shape). */
	subgraph_name: string | null;
	/** Null for chain subscriptions (CHECK subscriptions_kind_shape). */
	table_name: string | null;
	/** Chain-trigger filter array (the `SubgraphFilter` shape, JSON). Null for
	 *  subgraph subscriptions. Typed loosely here to avoid a shared→subgraphs
	 *  import cycle; the Zod schema in schemas/subscriptions.ts owns the shape. */
	triggers: unknown | null;
	filter: Generated<unknown>;
	format: ColumnType<
		SubscriptionFormat,
		SubscriptionFormat | undefined,
		SubscriptionFormat
	>;
	runtime: SubscriptionRuntime | null;
	url: string;
	signing_secret_enc: Buffer;
	auth_config: Generated<unknown>;
	max_retries: Generated<number>;
	timeout_ms: Generated<number>;
	concurrency: Generated<number>;
	circuit_failures: Generated<number>;
	circuit_opened_at: Date | null;
	last_delivery_at: Date | null;
	last_success_at: Date | null;
	last_error: string | null;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export type Subscription = Selectable<SubscriptionsTable>;
export type InsertSubscription = Insertable<SubscriptionsTable>;
export type UpdateSubscription = Updateable<SubscriptionsTable>;

export type OutboxStatus = "pending" | "delivered" | "dead";

export interface SubscriptionOutboxTable {
	id: Generated<string>;
	subscription_id: string;
	kind: ColumnType<
		SubscriptionKind,
		SubscriptionKind | undefined,
		SubscriptionKind
	>;
	/** Null for chain-subscription rows. */
	subgraph_name: string | null;
	/** Null for chain-subscription rows. */
	table_name: string | null;
	block_height: number | bigint;
	tx_id: string | null;
	row_pk: unknown;
	event_type: string;
	payload: unknown;
	dedup_key: string;
	attempt: Generated<number>;
	next_attempt_at: Generated<Date>;
	status: ColumnType<OutboxStatus, OutboxStatus | undefined, OutboxStatus>;
	is_replay: Generated<boolean>;
	delivered_at: Date | null;
	failed_at: Date | null;
	locked_by: string | null;
	locked_until: Date | null;
	created_at: Generated<Date>;
}

export type SubscriptionOutbox = Selectable<SubscriptionOutboxTable>;
export type InsertSubscriptionOutbox = Insertable<SubscriptionOutboxTable>;
export type UpdateSubscriptionOutbox = Updateable<SubscriptionOutboxTable>;

export interface SubscriptionDeliveriesTable {
	id: Generated<string>;
	/** Nullable after migration 0077 — outbox row may be cleaned up while
	 *  delivery telemetry is retained. */
	outbox_id: string | null;
	subscription_id: string;
	attempt: number;
	status_code: number | null;
	response_headers: unknown | null;
	response_body: string | null;
	error_message: string | null;
	duration_ms: number | null;
	dispatched_at: Generated<Date>;
}

export type SubscriptionDelivery = Selectable<SubscriptionDeliveriesTable>;
export type InsertSubscriptionDelivery =
	Insertable<SubscriptionDeliveriesTable>;

/** Single-row (id always TRUE) high-water mark for the chain-trigger evaluator.
 *  One loop serves all chain subscriptions, so the cursor is global. */
export interface TriggerEvaluatorStateTable {
	id: Generated<boolean>;
	last_processed_block: ColumnType<
		bigint,
		bigint | number | undefined,
		bigint | number
	>;
	updated_at: Generated<Date>;
}

export type TriggerEvaluatorState = Selectable<TriggerEvaluatorStateTable>;
