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

// ── Workflow tables ──────────────────────────────────────────────────

export interface WorkflowDefinitionsTable {
	id: Generated<string>;
	name: string;
	version: Generated<string>;
	status: Generated<string>;
	trigger_type: string;
	trigger_config: unknown;
	handler_path: string;
	source_code: string | null;
	retries_config: unknown | null;
	timeout_ms: number | null;
	api_key_id: string;
	project_id: string | null;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface WorkflowRunsTable {
	id: Generated<string>;
	definition_id: string;
	status: Generated<string>;
	trigger_type: string;
	trigger_data: unknown | null;
	dedup_key: string | null;
	error: string | null;
	started_at: Date | null;
	completed_at: Date | null;
	duration_ms: number | null;
	total_ai_tokens: Generated<number>;
	created_at: Generated<Date>;
}

export interface WorkflowStepsTable {
	id: Generated<string>;
	run_id: string;
	step_index: number;
	step_id: string;
	step_type: string;
	status: Generated<string>;
	input: unknown | null;
	output: unknown | null;
	error: string | null;
	retry_count: Generated<number>;
	ai_tokens_used: Generated<number>;
	started_at: Date | null;
	completed_at: Date | null;
	duration_ms: number | null;
	memo_key: string | null;
	parent_step_id: string | null;
	created_at: Generated<Date>;
}

export interface WorkflowQueueTable {
	id: Generated<string>;
	run_id: string;
	status: Generated<string>;
	attempts: Generated<number>;
	max_attempts: Generated<number>;
	scheduled_for: Generated<Date>;
	locked_at: Date | null;
	locked_by: string | null;
	error: string | null;
	created_at: Generated<Date>;
	completed_at: Date | null;
}

export interface WorkflowSchedulesTable {
	id: Generated<string>;
	definition_id: string;
	cron_expr: string;
	timezone: Generated<string>;
	next_run_at: Date;
	last_run_at: Date | null;
	enabled: Generated<boolean>;
	created_at: Generated<Date>;
}

export interface WorkflowCursorsTable {
	name: string;
	block_height: Generated<number>;
	updated_at: Generated<Date>;
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
	workflow_definitions: WorkflowDefinitionsTable;
	workflow_runs: WorkflowRunsTable;
	workflow_steps: WorkflowStepsTable;
	workflow_queue: WorkflowQueueTable;
	workflow_schedules: WorkflowSchedulesTable;
	workflow_cursors: WorkflowCursorsTable;
	workflow_signer_secrets: WorkflowSignerSecretsTable;
	workflow_budgets: WorkflowBudgetsTable;
	tenants: TenantsTable;
	tenant_usage_monthly: TenantUsageMonthlyTable;
	tenant_compute_addons: TenantComputeAddonsTable;
	workflow_ai_usage_daily: WorkflowAiUsageDailyTable;
	account_spend_caps: AccountSpendCapsTable;
	provisioning_audit_log: ProvisioningAuditLogTable;
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

// --- Workflow AI usage (per-tenant, per-day) ---
//
// Runner bumps this on every step.ai/generateText/generateObject call.
// Caps enforced by `getAiCapForPlan()` from `src/pricing.ts`; hit the
// cap → runner throws AI_CAP_REACHED and degrades the step cleanly.

export interface WorkflowAiUsageDailyTable {
	tenant_id: string;
	day: string; // 'yyyy-mm-dd'
	evals: Generated<number>;
	cost_usd_cents: Generated<number>;
	first_at: Generated<Date>;
	last_at: Generated<Date>;
}

export type WorkflowAiUsageDaily = Selectable<WorkflowAiUsageDailyTable>;
export type InsertWorkflowAiUsageDaily = Insertable<WorkflowAiUsageDailyTable>;
export type UpdateWorkflowAiUsageDaily = Updateable<WorkflowAiUsageDailyTable>;

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

export interface WorkflowBudgetsTable {
	id: Generated<string>;
	workflow_definition_id: string;
	/** Period key: "daily:YYYY-MM-DD" | "weekly:YYYY-Www" | "per-run:<uuid>". */
	period: string;
	ai_usd_used: Generated<string>;
	ai_tokens_used: Generated<string>;
	chain_microstx_used: Generated<string>;
	chain_tx_count: Generated<number>;
	run_count: Generated<number>;
	step_count: Generated<number>;
	reset_at: Date;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface WorkflowSignerSecretsTable {
	id: Generated<string>;
	account_id: string;
	name: string;
	/** AES-GCM ciphertext bytes produced by the runner's KMS on write. */
	encrypted_value: Buffer;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

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

export type WorkflowDefinition = Selectable<WorkflowDefinitionsTable>;
export type InsertWorkflowDefinition = Insertable<WorkflowDefinitionsTable>;
export type UpdateWorkflowDefinition = Updateable<WorkflowDefinitionsTable>;

export type WorkflowRun = Selectable<WorkflowRunsTable>;
export type InsertWorkflowRun = Insertable<WorkflowRunsTable>;
export type UpdateWorkflowRun = Updateable<WorkflowRunsTable>;

export type WorkflowStep = Selectable<WorkflowStepsTable>;
export type InsertWorkflowStep = Insertable<WorkflowStepsTable>;
export type UpdateWorkflowStep = Updateable<WorkflowStepsTable>;

export type WorkflowQueueItem = Selectable<WorkflowQueueTable>;
export type InsertWorkflowQueueItem = Insertable<WorkflowQueueTable>;

export type WorkflowSchedule = Selectable<WorkflowSchedulesTable>;
export type InsertWorkflowSchedule = Insertable<WorkflowSchedulesTable>;
export type UpdateWorkflowSchedule = Updateable<WorkflowSchedulesTable>;

export type WorkflowCursor = Selectable<WorkflowCursorsTable>;

export type WorkflowSignerSecret = Selectable<WorkflowSignerSecretsTable>;
export type InsertWorkflowSignerSecret = Insertable<WorkflowSignerSecretsTable>;
export type UpdateWorkflowSignerSecret = Updateable<WorkflowSignerSecretsTable>;

export type WorkflowBudget = Selectable<WorkflowBudgetsTable>;
export type InsertWorkflowBudget = Insertable<WorkflowBudgetsTable>;
export type UpdateWorkflowBudget = Updateable<WorkflowBudgetsTable>;

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
