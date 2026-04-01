import type { Generated, Insertable, Selectable, Updateable } from "kysely";

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

export interface StreamsTable {
	id: Generated<string>;
	name: string;
	status: Generated<string>;
	filters: unknown;
	options: Generated<unknown>;
	endpoint_url: string;
	signing_secret: string | null;
	api_key_id: string;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface StreamMetricsTable {
	stream_id: string;
	last_triggered_at: Date | null;
	last_triggered_block: number | null;
	total_deliveries: Generated<number>;
	failed_deliveries: Generated<number>;
	error_message: string | null;
}

export interface JobsTable {
	id: Generated<string>;
	stream_id: string;
	block_height: number;
	status: Generated<string>;
	attempts: Generated<number>;
	locked_at: Date | null;
	locked_by: string | null;
	error: string | null;
	backfill: Generated<boolean>;
	created_at: Generated<Date>;
	completed_at: Date | null;
}

export interface IndexProgressTable {
	network: string;
	last_indexed_block: Generated<number>;
	last_contiguous_block: Generated<number>;
	highest_seen_block: Generated<number>;
	updated_at: Generated<Date>;
}

export interface DeliveriesTable {
	id: Generated<string>;
	stream_id: string;
	job_id: string | null;
	block_height: number;
	status: string;
	status_code: number | null;
	response_time_ms: number | null;
	attempts: Generated<number>;
	error: string | null;
	payload: unknown;
	created_at: Generated<Date>;
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
	api_key_id: string;
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

// ── Database interface ────────────────────────────────────────────────

export interface Database {
	blocks: BlocksTable;
	transactions: TransactionsTable;
	events: EventsTable;
	streams: StreamsTable;
	stream_metrics: StreamMetricsTable;
	jobs: JobsTable;
	index_progress: IndexProgressTable;
	deliveries: DeliveriesTable;
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

export type Stream = Selectable<StreamsTable>;
export type InsertStream = Insertable<StreamsTable>;
export type UpdateStreamRow = Updateable<StreamsTable>;

export type StreamMetrics = Selectable<StreamMetricsTable>;
export type InsertStreamMetrics = Insertable<StreamMetricsTable>;
export type UpdateStreamMetrics = Updateable<StreamMetricsTable>;

export type Job = Selectable<JobsTable>;
export type InsertJob = Insertable<JobsTable>;
export type UpdateJob = Updateable<JobsTable>;

export type IndexProgress = Selectable<IndexProgressTable>;
export type InsertIndexProgress = Insertable<IndexProgressTable>;
export type UpdateIndexProgress = Updateable<IndexProgressTable>;

export type Delivery = Selectable<DeliveriesTable>;
export type InsertDelivery = Insertable<DeliveriesTable>;
export type UpdateDelivery = Updateable<DeliveriesTable>;

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
