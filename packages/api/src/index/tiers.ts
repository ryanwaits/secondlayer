export type IndexTier = "free" | "build" | "scale" | "enterprise";

export type IndexTierConfig = {
	rateLimitPerSecond: number | null;
};

export const INDEX_TIER_CONFIG: Record<IndexTier, IndexTierConfig> = {
	free: { rateLimitPerSecond: 0 },
	build: { rateLimitPerSecond: 50 },
	scale: { rateLimitPerSecond: 250 },
	enterprise: { rateLimitPerSecond: null },
};
