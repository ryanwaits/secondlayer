export interface Account {
	id: string;
	email: string;
	plan: string;
	displayName: string | null;
	bio: string | null;
	slug: string | null;
	avatarUrl: string | null;
	createdAt: string;
}

export type ApiKeyProduct = "account" | "streams" | "index";
export type ApiKeyTier = "free" | "build" | "scale" | "enterprise";

export interface ApiKey {
	id: string;
	prefix: string;
	name: string;
	status: string;
	product: ApiKeyProduct;
	tier: ApiKeyTier | null;
	createdAt: string;
	lastUsedAt: string | null;
}

export interface SubgraphSummary {
	name: string;
	version: string;
	status: string;
	lastProcessedBlock: number | null;
	totalProcessed: number;
	totalRows?: number;
	totalErrors: number;
	tables: string[];
	resourceWarning?: {
		code: string;
		message: string;
		plan?: string;
		blockRange: number;
		processorMemoryMb: number;
		recommendedPlan: "launch";
	};
	createdAt: string;
}

export interface AccountInsight {
	id: string;
	category: string;
	insightType: string;
	resourceId: string | null;
	severity: "info" | "warning" | "danger";
	title: string;
	body: string;
	data: Record<string, unknown>;
	createdAt: string;
	expiresAt: string | null;
}

export interface Project {
	id: string;
	name: string;
	slug: string;
	network: string;
	nodeRpc: string | null;
	settings: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface TeamMember {
	id: string;
	role: string;
	email: string;
	displayName: string | null;
	avatarUrl: string | null;
	createdAt: string;
}

export interface TeamInvitation {
	id: string;
	email: string;
	role: string;
	expiresAt: string;
	createdAt: string;
}

export interface SystemStatus {
	status: "healthy" | "degraded";
	chainTip: number | null;
	api?: ApiTelemetryStatus;
	node?: {
		status: ServiceHealthStatus;
	};
	services?: ServiceHealth[];
	reorgs?: {
		last_24h: number | null;
	};
	streams?: {
		status: "ok" | "unavailable";
		tip: {
			block_height: number;
			index_block_hash: string;
			burn_block_height: number;
			lag_seconds: number;
		} | null;
	};
	index?: IndexFreshnessStatus;
	recentDeliveries: number;
	timestamp: string;
}

export type ServiceHealthStatus = "ok" | "degraded" | "unavailable";

export interface ServiceHealth {
	name: "api" | "database" | "indexer" | "l2_decoder" | string;
	status: ServiceHealthStatus;
}

export interface ApiTelemetryStats {
	latency: {
		p50_ms: number | null;
		p95_ms: number | null;
	};
	error_rate: number;
	requests: number;
	errors_5xx: number;
}

export interface ApiTelemetryStatus extends ApiTelemetryStats {
	groups: Record<string, ApiTelemetryStats>;
	window_seconds: number;
}

export interface IndexDecoderFreshness {
	decoder: string;
	eventType: "ft_transfer" | "nft_transfer";
	status: "ok" | "degraded" | "unavailable";
	lagSeconds: number | null;
	checkpointBlockHeight: number | null;
	tipBlockHeight: number | null;
	lastDecodedAt: string | null;
}

export interface IndexFreshnessStatus {
	status: "ok" | "degraded" | "unavailable";
	decoders: IndexDecoderFreshness[];
}

// ── Admin ──

export interface WaitlistEntry {
	id: string;
	email: string;
	source: string;
	status: "pending" | "approved" | "joined";
	createdAt: string;
}

export interface AdminAccount {
	id: string;
	email: string;
	plan: string;
	createdAt: string;
	subgraphCount: number;
	lastActive: string | null;
}

export interface AdminStats {
	totalAccounts: number;
	pendingWaitlist: number;
	totalSubgraphs: number;
	activeSubgraphs: number;
	errorSubgraphs: number;
}

export interface SubgraphFilter {
	type: string;
	[key: string]: unknown;
}

export interface SubgraphDetail {
	name: string;
	version: string;
	schemaHash?: string;
	status: string;
	lastProcessedBlock: number | null;
	description?: string;
	sources?: Record<string, SubgraphFilter>;
	definition?: Record<string, unknown>;
	health: {
		totalProcessed: number;
		totalErrors: number;
		errorRate: number;
		lastError: string | null;
		lastErrorAt: string | null;
	};
	sync: {
		status?: "synced" | "catching_up" | "reindexing" | "error";
		mode?: "sync" | "reindex";
		startBlock?: number;
		lastProcessedBlock?: number;
		blocksRemaining: number;
		chainTip: number | null;
		sourceChainTip?: number | null;
		targetBlock?: number | null;
		processedBlocks?: number;
		totalBlocks?: number;
		progress: number;
	};
	tables: Record<
		string,
		{
			rowCount: number;
			endpoint: string;
			columns: Record<
				string,
				{
					type: string;
					nullable?: boolean;
					indexed?: boolean;
					searchable?: boolean;
					default?: string | number | boolean;
				}
			>;
			indexes?: string[][];
			uniqueKeys?: string[][];
			example: unknown;
		}
	>;
	createdAt: string;
	updatedAt: string;
}

export type SubscriptionStatus = "active" | "paused" | "error";
export type SubscriptionFormat =
	| "standard-webhooks"
	| "inngest"
	| "trigger"
	| "cloudflare"
	| "cloudevents"
	| "raw";
export type SubscriptionRuntime = "inngest" | "trigger" | "cloudflare" | "node";

export interface SubscriptionSummary {
	id: string;
	name: string;
	status: SubscriptionStatus;
	subgraphName: string;
	tableName: string;
	format: SubscriptionFormat;
	runtime: SubscriptionRuntime | null;
	url: string;
	lastDeliveryAt: string | null;
	lastSuccessAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface SubscriptionDetail extends SubscriptionSummary {
	filter: Record<string, unknown>;
	authConfig: Record<string, unknown>;
	maxRetries: number;
	timeoutMs: number;
	concurrency: number;
	circuitFailures: number;
	circuitOpenedAt: string | null;
	lastError: string | null;
}

export interface DeliveryRow {
	id: string;
	attempt: number;
	statusCode: number | null;
	errorMessage: string | null;
	durationMs: number | null;
	responseBody: string | null;
	dispatchedAt: string;
}

export interface DeadRow {
	id: string;
	eventType: string;
	attempt: number;
	blockHeight: number;
	txId: string | null;
	payload: Record<string, unknown>;
	failedAt: string | null;
	createdAt: string;
}
