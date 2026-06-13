export type IndexTier = "free" | "build" | "scale" | "enterprise";

export type IndexTierConfig = {
	rateLimitPerSecond: number | null;
};

// Paid must never be slower than anonymous: free keyed matches the anon
// limit, Pro (build) buys real headroom over it. Free is severely throttled —
// it's the tip-only demo, not a bulk-read budget; volume goes prepaid or flat.
export const INDEX_TIER_CONFIG: Record<IndexTier, IndexTierConfig> = {
	free: { rateLimitPerSecond: 10 },
	build: { rateLimitPerSecond: 250 },
	scale: { rateLimitPerSecond: 500 },
	enterprise: { rateLimitPerSecond: null },
};

// Shared global limit for anonymous open-beta reads. Clients always see
// X-RateLimit-* headers; this guards against runaway unauthed scraping.
export const INDEX_ANON_RATE_LIMIT_PER_SECOND = 10;
