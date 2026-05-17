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

// Shared global limit for anonymous open-beta reads. Clients always see
// X-RateLimit-* headers; this guards against runaway unauthed scraping.
export const INDEX_ANON_RATE_LIMIT_PER_SECOND = 100;
