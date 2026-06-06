import { z } from "zod/v4";

// ── Deploy Subgraph Request ─────────────────────────────────────────────────

export interface DeploySubgraphRequest {
	name: string;
	version?: string;
	description?: string;
	sources: Record<string, Record<string, unknown>>;
	schema: Record<string, unknown>;
	handlerCode: string;
	/** Override the definition's startBlock for this deploy only. */
	startBlock?: number;
	/** Original TypeScript source, persisted so chat can read/diff/edit later. */
	sourceCode?: string;
	/**
	 * BYO data plane: a user-owned Postgres connection string. When set, the
	 * subgraph's schema, handler writes, and serving reads live in this DB instead
	 * of the managed one. Stored encrypted at rest, never returned.
	 */
	databaseUrl?: string;
	/** Validate the connection + print the DDL/grant plan without deploying. */
	dryRun?: boolean;
}

export const DeploySubgraphRequestSchema: z.ZodType<DeploySubgraphRequest> =
	z.object({
		name: z
			.string()
			.regex(/^[a-z0-9-]+$/, "lowercase alphanumeric + hyphens only")
			.max(63),
		version: z.string().optional(),
		description: z.string().optional(),
		sources: z
			.record(z.string(), z.record(z.string(), z.unknown()))
			.refine(
				(s) => Object.keys(s).length > 0,
				"Must have at least one source",
			),
		schema: z.record(z.string(), z.unknown()),
		handlerCode: z.string().max(1_048_576, "handler code exceeds 1MB limit"),
		startBlock: z.number().int().nonnegative().optional(),
		sourceCode: z
			.string()
			.max(1_048_576, "source code exceeds 1MB limit")
			.optional(),
		databaseUrl: z
			.string()
			.url()
			.refine(
				(u) => u.startsWith("postgres://") || u.startsWith("postgresql://"),
				"must be a postgres:// connection string",
			)
			.optional(),
		dryRun: z.boolean().optional(),
	});

export interface DeploySubgraphResponse {
	action: "created" | "unchanged" | "handler_updated" | "updated" | "reindexed";
	subgraphId: string;
	version: string;
	message: string;
	operationId?: string;
	reindexStarted?: boolean;
	diff?: {
		addedTables: string[];
		removedTables: string[];
		addedColumns: Record<string, string[]>;
		breakingChanges: string[];
	};
}

// Subgraph API response types

export interface SubgraphSummary {
	name: string;
	version: string;
	status: string;
	lastProcessedBlock: number;
	totalProcessed: number;
	totalErrors: number;
	tables: string[];
	chainTip: number;
	sourceChainTip?: number;
	targetBlock?: number;
	progress: number;
	blocksRemaining?: number;
	syncMode?: "sync" | "reindex";
	resourceWarning?: SubgraphResourceWarning;
	gapCount: number;
	integrity: "complete" | "gaps_detected";
	createdAt: string;
}

export interface SubgraphGapRange {
	start: number;
	end: number;
	size: number;
	reason: string;
}

export interface SubgraphSyncInfo {
	status: "synced" | "catching_up" | "reindexing" | "error";
	mode?: "sync" | "reindex";
	startBlock: number;
	lastProcessedBlock: number;
	/**
	 * Backward-compatible denominator for progress displays. During reindexing,
	 * this is the reindex target block rather than the live source chain tip.
	 */
	chainTip: number;
	sourceChainTip?: number;
	targetBlock?: number;
	blocksRemaining: number;
	processedBlocks?: number;
	totalBlocks?: number;
	progress: number;
	resourceWarning?: SubgraphResourceWarning;
	gaps: {
		count: number;
		totalMissingBlocks: number;
		ranges: SubgraphGapRange[];
	};
	integrity: "complete" | "gaps_detected";
}

export interface SubgraphResourceWarning {
	code: string;
	message: string;
	plan?: string;
	blockRange: number;
	processorMemoryMb: number;
	recommendedPlan: "launch";
}

export interface SubgraphDetail {
	name: string;
	version: string;
	schemaHash?: string;
	status: string;
	lastProcessedBlock: number;
	description?: string;
	sources?: Record<string, unknown>;
	definition?: Record<string, unknown>;
	health: {
		totalProcessed: number;
		totalErrors: number;
		errorRate: number;
		lastError: string | null;
		lastErrorAt: string | null;
	};
	sync: SubgraphSyncInfo;
	tables: Record<
		string,
		{
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
			rowCount: number;
			example: string;
			indexes?: string[][];
			uniqueKeys?: string[][];
		}
	>;
	createdAt: string;
	updatedAt: string;
}

export interface SubgraphGapEntry {
	start: number;
	end: number;
	size: number;
	reason: string;
	detectedAt: string;
	resolvedAt: string | null;
}

export interface SubgraphGapsResponse {
	data: SubgraphGapEntry[];
	meta: {
		total: number;
		totalMissingBlocks: number;
		limit: number;
		offset: number;
	};
}

export interface ReindexResponse {
	message: string;
	fromBlock: number;
	toBlock: number | string;
	operationId?: string;
	status?: "queued" | "running" | "cancel_requested";
}

export interface SubgraphQueryParams {
	sort?: string;
	order?: string;
	limit?: number;
	offset?: number;
	fields?: string;
	filters?: Record<string, string>;
}

/**
 * Request shape for `GET /api/subgraphs/:subgraphName/:tableName/aggregate`.
 * `filters` reuses the list/count where-surface; the rest name the columns to
 * aggregate. SUM/MIN/MAX columns must be numeric (uint/int, plus `_block_height`).
 */
export interface SubgraphAggregateParams {
	filters?: Record<string, string>;
	count?: boolean;
	countDistinct?: string[];
	sum?: string[];
	min?: string[];
	max?: string[];
}

/**
 * Aggregate response. Keys are present only for requested aggregates.
 * `count`/`countDistinct` are JSON numbers (counts << 2^53); `sum`/`min`/`max`
 * are lossless strings (NUMERIC `::text`). `sum` of an empty set is `"0"`;
 * `min`/`max` are `null` when the filtered set is empty or all-null.
 */
export interface SubgraphAggregateResponse {
	count?: number;
	countDistinct?: Record<string, number>;
	sum?: Record<string, string>;
	min?: Record<string, string | null>;
	max?: Record<string, string | null>;
}
