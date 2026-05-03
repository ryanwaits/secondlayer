export type StreamsTier = "free" | "build" | "scale" | "enterprise";

export type StreamsTierConfig = {
	rateLimitPerSecond: number | null;
	retentionDays: number | null;
};

// TODO: retention is currently approximated as blocks-per-day.
// Post-Nakamoto Stacks blocks are produced faster than 10 minutes,
// so 144 blocks/day under-enforces the retention window. Before any
// external customer relies on tier SLAs, switch to wall-clock-based:
// add tip_ts to StreamsTip, compute cutoff_ts = tip_ts - days*86400,
// resolve to the lowest block_height whose ts >= cutoff_ts.
export const STREAMS_BLOCKS_PER_DAY = 144;

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
