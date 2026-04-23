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
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
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

export interface ApiKeysTable {
	id: Generated<string>;
	key_hash: string;
	key_prefix: string;
	name: string | null;
	status: Generated<string>;
	rate_limit: Generated<number>;
	ip_address: string;
	account_id: string;
	last_used_at: Date | null;
	revoked_at: Date | null;
	created_at: Generated<Date>;
}

export interface AccountsTable {
	id: Generated<string>;
	email: string;
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
}

export interface UsageSnapshotsTable {
	id: Generated<string>;
	account_id: string;
	measured_at: Generated<Date>;
	storage_bytes: Generated<number>;
}

export interface WaitlistTable {
	id: Generated<string>;
	email: string;
	source: Generated<string>;
	status: Generated<string>;
	created_at: Generated<Date>;
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

export interface ChatSessionsTable {
	id: Generated<string>;
	account_id: string;
	title: string | null;
	summary: unknown | null;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface ChatMessagesTable {
	id: Generated<string>;
	chat_session_id: string;
	role: string;
	parts: unknown;
	metadata: unknown | null;
	created_at: Generated<Date>;
}

// ── Database interface ────────────────────────────────────────────────

export interface Database {
	blocks: BlocksTable;
	transactions: TransactionsTable;
	events: EventsTable;
	index_progress: IndexProgressTable;
	subgraphs: SubgraphsTable;
	api_keys: ApiKeysTable;
	accounts: AccountsTable;
	sessions: SessionsTable;
	magic_links: MagicLinksTable;
	usage_daily: UsageDailyTable;
	usage_snapshots: UsageSnapshotsTable;
	waitlist: WaitlistTable;
	account_insights: AccountInsightsTable;
	account_agent_runs: AccountAgentRunsTable;
	subgraph_health_snapshots: SubgraphHealthSnapshotsTable;
	subgraph_processing_stats: SubgraphProcessingStatsTable;
	subgraph_table_snapshots: SubgraphTableSnapshotsTable;
	subgraph_gaps: SubgraphGapsTable;
	subgraph_usage_daily: SubgraphUsageDailyTable;
	projects: ProjectsTable;
	team_members: TeamMembersTable;
	team_invitations: TeamInvitationsTable;
	chat_sessions: ChatSessionsTable;
	chat_messages: ChatMessagesTable;
	tenants: TenantsTable;
	tenant_usage_monthly: TenantUsageMonthlyTable;
	tenant_compute_addons: TenantComputeAddonsTable;
	account_spend_caps: AccountSpendCapsTable;
	provisioning_audit_log: ProvisioningAuditLogTable;
	subscriptions: SubscriptionsTable;
	subscription_outbox: SubscriptionOutboxTable;
	subscription_deliveries: SubscriptionDeliveriesTable;
}

// --- Tenants (dedicated hosting) ---

export type TenantStatus =
	| "provisioning"
	| "active"
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
	ai_cap_cents: number | null;
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

export type Event = Selectable<EventsTable>;
export type InsertEvent = Insertable<EventsTable>;
export type UpdateEvent = Updateable<EventsTable>;

export type IndexProgress = Selectable<IndexProgressTable>;
export type InsertIndexProgress = Insertable<IndexProgressTable>;
export type UpdateIndexProgress = Updateable<IndexProgressTable>;

export type Subgraph = Selectable<SubgraphsTable>;
export type InsertSubgraph = Insertable<SubgraphsTable>;
export type UpdateSubgraph = Updateable<SubgraphsTable>;

export type ApiKey = Selectable<ApiKeysTable>;
export type InsertApiKey = Insertable<ApiKeysTable>;
export type UpdateApiKey = Updateable<ApiKeysTable>;

export type Account = Selectable<AccountsTable>;
export type InsertAccount = Insertable<AccountsTable>;

export type MagicLink = Selectable<MagicLinksTable>;
export type InsertMagicLink = Insertable<MagicLinksTable>;

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

export type ChatSession = Selectable<ChatSessionsTable>;
export type InsertChatSession = Insertable<ChatSessionsTable>;
export type UpdateChatSession = Updateable<ChatSessionsTable>;

export type ChatMessage = Selectable<ChatMessagesTable>;
export type InsertChatMessage = Insertable<ChatMessagesTable>;

// ── Subscriptions (subgraph event subscriptions) ─────────────────────

export type SubscriptionStatus = "active" | "paused" | "error";
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
	subgraph_name: string;
	table_name: string;
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
	subgraph_name: string;
	table_name: string;
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
	outbox_id: string;
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
