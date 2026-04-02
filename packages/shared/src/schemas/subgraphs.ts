import { z } from "zod/v4";

// ── Deploy Subgraph Request ─────────────────────────────────────────────────

export interface DeploySubgraphRequest {
	name: string;
	version?: string;
	description?: string;
	sources: Record<string, Record<string, unknown>>;
	schema: Record<string, unknown>;
	handlerCode: string;
	reindex?: boolean;
}

export const DeploySubgraphRequestSchema: z.ZodType<DeploySubgraphRequest> =
	z.object({
		name: z
			.string()
			.regex(/^[a-z0-9-]+$/, "lowercase alphanumeric + hyphens only")
			.max(63),
		version: z.string().optional(),
		description: z.string().optional(),
		sources: z.record(z.string(), z.record(z.string(), z.unknown())).refine(
			(s) => Object.keys(s).length > 0,
			"Must have at least one source",
		),
		schema: z.record(z.string(), z.unknown()),
		handlerCode: z.string().max(1_048_576, "handler code exceeds 1MB limit"),
		reindex: z.boolean().optional(),
	});

export interface DeploySubgraphResponse {
	action: "created" | "unchanged" | "updated" | "reindexed";
	subgraphId: string;
	message: string;
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
	progress: number;
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
	startBlock: number;
	lastProcessedBlock: number;
	chainTip: number;
	blocksRemaining: number;
	progress: number;
	gaps: {
		count: number;
		totalMissingBlocks: number;
		ranges: SubgraphGapRange[];
	};
	integrity: "complete" | "gaps_detected";
}

export interface SubgraphDetail {
	name: string;
	version: string;
	status: string;
	lastProcessedBlock: number;
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
			columns: Record<string, { type: string; nullable?: boolean }>;
			rowCount: number;
			example: string;
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
}

export interface SubgraphQueryParams {
	sort?: string;
	order?: string;
	limit?: number;
	offset?: number;
	fields?: string;
	filters?: Record<string, string>;
}
