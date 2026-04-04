// Marketplace API response types — mirrors @secondlayer/shared/schemas/marketplace

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
	forkCount?: number;
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
	forkedFrom: { id: string; name: string } | null;
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
