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
  webhook_url: string;
  webhook_secret: string | null;
  api_key_id: string | null;
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

export interface ViewsTable {
  id: Generated<string>;
  name: string;
  version: Generated<string>;
  status: Generated<string>;
  definition: unknown;
  schema_hash: string;
  handler_path: string;
  schema_name: string | null;
  last_processed_block: Generated<number>;
  last_error: string | null;
  last_error_at: Date | null;
  total_processed: Generated<number>;
  total_errors: Generated<number>;
  api_key_id: string | null;
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
  expires_at: Date;
  used_at: Date | null;
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
  views: ViewsTable;
  api_keys: ApiKeysTable;
  accounts: AccountsTable;
  sessions: SessionsTable;
  magic_links: MagicLinksTable;
  usage_daily: UsageDailyTable;
  usage_snapshots: UsageSnapshotsTable;
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

export type View = Selectable<ViewsTable>;
export type InsertView = Insertable<ViewsTable>;
export type UpdateView = Updateable<ViewsTable>;

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
