import { z } from "zod";

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
	/** Validate the definition + print the DDL plan without deploying. */
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
		dryRun: z.boolean().optional(),
	});

export interface DeploySubgraphResponse {
	action: "created" | "unchanged" | "handler_updated" | "updated" | "reindexed";
	subgraphId: string;
	version: string;
	message: string;
	/** Effective indexing start height. */
	start_block?: number;
	operationId?: string;
	reindexStarted?: boolean;
	/** Bounded candidate-event denominator for the reindex just started, when the
	 *  op was classifiable as sparse/light. Absent for heavy ops (no upfront estimate
	 *  possible) — check `sl subgraphs status` after ~30s for a rate-based ETA instead. */
	estimatedEvents?: number;
	/** Non-blocking deploy lints (e.g. handler reads a print field never observed on-chain). */
	warnings?: string[];
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
	totalRows?: number;
	totalErrors: number;
	tables: string[];
	chainTip: number;
	sourceChainTip?: number;
	targetBlock?: number;
	progress: number;
	blocksRemaining?: number;
	syncMode?: "sync" | "reindex";
	gapCount: number;
	/** history_filling = expected gaps while a tip-first backfill op runs. */
	integrity: "complete" | "gaps_detected" | "history_filling";
	visibility?: "public" | "private";
	/** Most recent indexing error reason + when it occurred, if any. */
	lastError?: string | null;
	lastErrorAt?: string | null;
	/** Last row mutation timestamp; powers per-card freshness. */
	updatedAt?: string | null;
	/** Number of subscriptions attached to this subgraph. */
	subscriptionCount?: number;
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
	/** Present while the populating operation is queued: approximate claim
	 *  position + honest event denominator + naive start estimate. */
	queue?: {
		position: number | null;
		estimatedEvents: number | null;
		estimatedStartSeconds: number | null;
	};
	/** Event-based progress for sparse syncs (block pct is meaningless when
	 *  most heights are skipped). */
	estimatedEvents?: number;
	processedEvents?: number;
	etaSeconds?: number | null;
	gaps: {
		count: number;
		totalMissingBlocks: number;
		ranges: SubgraphGapRange[];
	};
	/** history_filling = expected gaps while a tip-first backfill op runs. */
	integrity: "complete" | "gaps_detected" | "history_filling";
}

export interface SubgraphDetail {
	name: string;
	version: string;
	schemaHash?: string;
	status: string;
	visibility?: "public" | "private";
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
			indexes?: readonly (readonly string[])[];
			uniqueKeys?: readonly (readonly string[])[];
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
