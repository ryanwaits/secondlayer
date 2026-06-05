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

/** Reorg-safety margin for the public Streams tip: events are served only up to
 *  `tip - this` blocks so consumers never read a height likely to reorg. The L2
 *  decoder and SDK consumer rewind on reorg, so a small margin is sufficient.
 *  Replaces an earlier clamp that subtracted `lag_seconds` (a wall-clock value)
 *  from a block height — a unit mismatch that, post-Nakamoto (~10s blocks), held
 *  the servable tip back by ~`lag_seconds` blocks (~80s of latency). Override
 *  via the `STREAMS_TIP_REORG_MARGIN_BLOCKS` env var for ops tuning. */
export const STREAMS_TIP_REORG_MARGIN_BLOCKS = 2;

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
