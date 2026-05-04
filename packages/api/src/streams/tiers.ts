export type StreamsTier = "free" | "build" | "scale" | "enterprise";

export type StreamsTierConfig = {
	rateLimitPerSecond: number | null;
	retentionDays: number | null;
};

// Post-Nakamoto Stacks blocks target roughly five-second cadence.
// Retention remains height-based in v1 to avoid changing the public tip shape;
// switch to a wall-clock cutoff if block cadence drifts materially.
export const STREAMS_BLOCKS_PER_DAY = 17_280;

export const STREAMS_TIER_CONFIG: Record<StreamsTier, StreamsTierConfig> = {
	free: { rateLimitPerSecond: 10, retentionDays: 7 },
	build: { rateLimitPerSecond: 50, retentionDays: 30 },
	scale: { rateLimitPerSecond: 250, retentionDays: 90 },
	enterprise: { rateLimitPerSecond: null, retentionDays: null },
};

export function getStreamsRetentionCutoff(
	tier: StreamsTier,
	currentTipHeight: number,
): number | null {
	const retentionDays = STREAMS_TIER_CONFIG[tier].retentionDays;
	if (retentionDays === null) return null;
	return Math.max(0, currentTipHeight - retentionDays * STREAMS_BLOCKS_PER_DAY);
}
