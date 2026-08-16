export type IndexTier = "free" | "internal";

export type IndexTierConfig = {
	rateLimitPerSecond: number | null;
};

// Keyed must never be slower than anonymous: free matches the anon limit.
// Free is severely throttled — it's the tip-only demo, not a bulk-read
// budget; volume goes through prepaid credits. Internal is unthrottled.
export const INDEX_TIER_CONFIG: Record<IndexTier, IndexTierConfig> = {
	free: { rateLimitPerSecond: 10 },
	internal: { rateLimitPerSecond: null },
};

// Shared global limit for anonymous open-beta reads. Clients always see
// X-RateLimit-* headers; this guards against runaway unauthed scraping.
export const INDEX_ANON_RATE_LIMIT_PER_SECOND = 10;
