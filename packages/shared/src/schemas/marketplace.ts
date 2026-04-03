import { z } from "zod/v4";

// ── Request Schemas ───────────────────────────────────────────────────

export const PublishSubgraphRequestSchema = z.object({
	tags: z.array(z.string().max(30)).max(5).optional(),
	description: z.string().max(500).optional(),
});

export const UpdateProfileRequestSchema = z.object({
	display_name: z.string().max(50).optional(),
	bio: z.string().max(300).optional(),
	slug: z
		.string()
		.regex(/^[a-z0-9-]+$/, "lowercase alphanumeric + hyphens only")
		.min(3)
		.max(30)
		.optional(),
});

export const ForkSubgraphRequestSchema = z.object({
	sourceSubgraphName: z.string(),
	newName: z
		.string()
		.regex(/^[a-z0-9-]+$/, "lowercase alphanumeric + hyphens only")
		.max(63)
		.optional(),
});

// ── Response Types ────────────────────────────────────────────────────

export interface MarketplaceCreator {
	displayName: string | null;
	slug: string | null;
}

export interface MarketplaceSubgraphSummary {
	name: string;
	description: string | null;
	tags: string[];
	creator: MarketplaceCreator;
	status: string;
	version: string;
	tables: string[];
	totalQueries7d: number;
	progress: number;
	createdAt: string;
}

export interface MarketplaceSubgraphDetail extends MarketplaceSubgraphSummary {
	tableSchemas: Record<
		string,
		{
			columns: Record<string, { type: string; nullable?: boolean }>;
			rowCount: number;
			endpoint: string;
		}
	>;
	sources: Record<string, unknown>;
	startBlock: number;
	lastProcessedBlock: number;
	forkedFrom: string | null;
	usage: {
		totalQueries7d: number;
		totalQueries30d: number;
		daily: Array<{ date: string; count: number }>;
	};
}

export interface CreatorProfile {
	displayName: string | null;
	bio: string | null;
	avatarUrl: string | null;
	slug: string | null;
	subgraphs: MarketplaceSubgraphSummary[];
}
