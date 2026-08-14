/**
 * Types for the instance API surfaces the console reads. Ported from the
 * hosted web console and trimmed to what a single self-hosted instance
 * exposes — no accounts, projects, billing, or visibility tiers.
 */

export interface InstanceSummary {
	mode: string;
	network: string;
	instance_id: string | null;
	subgraphs: {
		name: string;
		status: string;
		start_block: number | null;
		last_processed_block: number | null;
	}[];
	subscriptions: { name: string; status: string; kind: string }[];
}

export interface HealthInfo {
	status: string;
	image_sha: string | null;
}

/** Trimmed `/status` view — the console reads tip + freshness only. */
export interface SystemStatus {
	status: string;
	network?: string;
	chainTip: number | null;
	timestamp: string;
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
	chainTip?: number;
	progress?: number;
	blocksRemaining?: number;
	syncMode?: "sync" | "reindex";
	gapCount?: number;
	integrity?: "complete" | "gaps_detected" | "history_filling";
	lastError?: string | null;
	lastErrorAt?: string | null;
	updatedAt?: string | null;
	subscriptionCount?: number;
	createdAt: string;
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
		estimatedEvents?: number;
		processedEvents?: number;
		etaSeconds?: number | null;
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
			indexes?: readonly (readonly string[])[];
			uniqueKeys?: readonly (readonly string[])[];
			example: unknown;
		}
	>;
	createdAt: string;
	updatedAt: string;
}

export type SubscriptionStatus = "active" | "paused" | "error";

export interface SubscriptionSummary {
	id: string;
	name: string;
	status: SubscriptionStatus;
	subgraphName: string;
	tableName: string;
	format: string;
	runtime: string | null;
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

/**
 * A tracked reindex/backfill job, as returned by
 * `GET /api/subgraphs/:name/operations`.
 */
export interface SubgraphOperation {
	id: string;
	subgraphName: string;
	kind: "backfill" | "reindex";
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	weight: string | null;
	fromBlock: number | null;
	toBlock: number | null;
	processedBlocks: number | null;
	cursorBlock: number | null;
	estimatedEvents: number | null;
	processedEvents: number | null;
	/** 0–1, or null when the job has reported no progress signal yet. */
	progress: number | null;
	queuePosition?: number;
	error: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	createdAt: string;
	updatedAt: string;
}
