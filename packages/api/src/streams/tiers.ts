export type StreamsTier = "free" | "build" | "scale" | "enterprise";

export type StreamsTierConfig = {
	rateLimitPerSecond: number | null;
	retentionDays: number | null;
};

// Post-Nakamoto Stacks blocks target roughly five-second cadence.
// Retention remains height-based in v1 to avoid changing the public tip shape;
// switch to a wall-clock cutoff if block cadence drifts materially.
export const STREAMS_BLOCKS_PER_DAY = 17_280;

/** When a caller hits `/v1/streams/events` with neither `cursor` nor
 *  `from_height`, the default window is `tip - this` blocks. Tightened
 *  from one day (~17280) to 1000 blocks (~80 minutes) post-2026-05 QA —
 *  the old default made first-touch responses look stale on every fresh
 *  cursor-less query. */
export const STREAMS_DEFAULT_FROM_HEIGHT_WINDOW_BLOCKS = 1_000;

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
