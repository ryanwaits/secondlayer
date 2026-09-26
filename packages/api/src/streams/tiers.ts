export type StreamsTier = "free" | "internal";

export type StreamsTierConfig = {
	rateLimitPerSecond: number | null;
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
 *  via the `STREAMS_TIP_REORG_MARGIN_BLOCKS` env var for ops tuning.
 *
 *  This is the PUBLIC-consumer default only. It must never be overloaded to
 *  also mean "the internal decoder's margin" — see
 *  `STREAMS_INTERNAL_TIP_REORG_MARGIN_BLOCKS` below. */
export const STREAMS_TIP_REORG_MARGIN_BLOCKS = 2;

/**
 * Reorg-safety margin for first-party decoder reads (an `internal`-tier
 * Streams tenant — the seeded `STREAMS_INTERNAL_API_KEY`/`sl-int_` key, or a
 * self-hosted `INSTANCE_TOKEN`). Founder decision, 2026-09-25:
 * margin 0, relying on the decoder's own reorg rewind
 * (`handleDecodedEventsReorg` hard-deletes decoded rows at/above the fork and
 * rewinds every decoder checkpoint in the SAME transaction as reorg detection
 * — see `packages/indexer/src/reorg.ts` / `decode/storage.ts`) plus 043's
 * webhook rollback deliveries. Measured reorg frequency:
 * 29 reorgs / 90d, depth 1 in 21 of them — margin 2 only ever hid 25/29,
 * so the margin was never doing much reorg-hiding work to begin with.
 *
 * A distinct constant, not a second meaning of `STREAMS_TIP_REORG_MARGIN_BLOCKS`
 * — that env var stays the public-consumer knob (see its doc comment above).
 */
export const STREAMS_INTERNAL_TIP_REORG_MARGIN_BLOCKS = 0;

/** Per-second rate-limit bucket for accountless (no-tenant) Streams reads.
 *  More generous than the keyless Index anon limit
 *  (`INDEX_ANON_RATE_LIMIT_PER_SECOND` = 10). Like that bucket, it is a single
 *  shared global counter, not per-caller. */
export const STREAMS_ANON_RATE_LIMIT_PER_SECOND = 50;

// No retention ladder (founder decision, 2026-09-24): every account reads
// full history; rows past the monthly allowance are a paid read, not a
// blocked one. `retentionDays` and `getStreamsRetentionCutoff` are gone.
export const STREAMS_TIER_CONFIG: Record<StreamsTier, StreamsTierConfig> = {
	free: { rateLimitPerSecond: 10 },
	internal: { rateLimitPerSecond: null },
};
