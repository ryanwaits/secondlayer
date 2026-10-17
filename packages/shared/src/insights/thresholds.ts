// Detector thresholds. Named constants, not config. Tune from real data;
// until then these stay conservative: a wrong insight costs more trust than
// a missed one.
//
// This file must stay import-free. The SDK's webhook doctor imports it, and
// the doctor reaches the browser through apps/web, so anything imported here
// would ship to the client bundle.
//
// Constants computed from an expression carry an explicit `: number`: the
// bundled `.d.ts` otherwise types them `unknown`.

// ── Webhook doctor (shared with the SDK / `sl webhooks doctor`) ────────
export const RATE_LIMITED_MIN_ATTEMPTS = 10;
export const RATE_LIMITED_MIN_RATIO = 0.5;
export const DOWN_MIN_CONSECUTIVE = 5;
export const REJECTS_MIN_CONSECUTIVE = 5;
export const SLOW_WINDOW = 20;
export const SLOW_MIN_SAMPLES = 5;
export const SLOW_TIMEOUT_RATIO = 0.5;
export const LAG_WINDOW = 20;
export const LAG_MIN_SAMPLES = 5;
export const LAG_THRESHOLD_MS = 60_000;

// ── Tenant rules ───────────────────────────────────────────────────────
/** Consecutive newest 2xx HTML responses that mean a login wall. */
export const LOGIN_WALL_MIN_CONSECUTIVE = 20;
/** Share of prior-week 2xx responses that must have been JSON. */
export const LOGIN_WALL_PRIOR_JSON_RATIO = 0.8;
/** Prior-week successful responses needed before a baseline counts. */
export const LOGIN_WALL_MIN_PRIOR = 10;
export const SLOWING_DAYS = 14;
export const SLOWING_MIN_RISING_DAYS = 10;
export const SLOWING_MIN_R2 = 0.8;
export const TLS_WARN_DAYS = 14;
/** Dead outbox rows are deleted at 90 days; warn at 83. */
export const DEAD_LETTER_WARN_AGE_DAYS = 83;
export const DEAD_LETTER_DELETE_AGE_DAYS = 90;
export const TEST_ENDPOINT_MIN_AGE_DAYS = 7;
export const HANDLER_ERRORS_MIN_24H = 10;
/** Blocks behind tip, for 3 consecutive snapshots. */
export const SUBGRAPH_LAG_BLOCKS = 20;
export const SUBGRAPH_LAG_SNAPSHOTS = 3;
export const SUBGRAPH_LAG_LOSING_BLOCKS = 500;

// ── Platform rules ─────────────────────────────────────────────────────
/**
 * Index and Streams cap one page at 1000 rows
 * (`packages/api/src/index/_shared.ts` `Math.min(1000, parsed)`,
 * `packages/api/src/routes/streams.ts` `limit: Math.min(1000, limit)`).
 */
export const PAGE_CAP_ROWS = 1000;
export const DUPLICATE_READS_MIN_PAGES = 3;
export const DUPLICATE_READS_WINDOW_MS = 3_600_000;
/** Only repeats that started within this long ago count as current. */
export const DUPLICATE_READS_LOOKBACK_MS: number = 24 * 3_600_000;
export const POLLING_MIN_DURATION_MS = 3_600_000;
/** Requests needed in the window before an interval means anything. */
export const POLLING_MIN_REQUESTS = 5;
export const POLLING_LOOKBACK_MS: number = 6 * 3_600_000;
export const POLLING_MAX_STDDEV_RATIO = 0.2;
/** A request this soon after the previous one is a cursor-follow page of the same poll. */
export const POLLING_FOLLOW_GAP_MS = 10_000;
export const POLLING_MIN_EMPTY_RATIO = 0.8;
export const SERVER_ERRORS_MIN_5XX = 3;
export const BACKFILL_DAY_SHARE = 0.25;
export const BACKFILL_FULL_PAGE_RATIO = 0.9;
/** A day under this many rows is never called a backfill, however full its pages. */
export const BACKFILL_MIN_DAY_ROWS = 100_000;
export const CREDITS_RUNWAY_WARN_DAYS = 7;
/** An account key idle this many days (or unused since creation) is flagged. */
export const KEY_UNUSED_DAYS = 30;
/** A revoked key called within this long is still in use; older calls only
 *  count toward the 24h evidence, so the insight clears once calls stop. */
export const REVOKED_KEY_ACTIVE_MS = 3_600_000;

// ── Lifecycle ──────────────────────────────────────────────────────────
/** A resolved insight stays visible as "recovered" for this long. */
export const RECOVERED_VISIBLE_MS: number = 24 * 3600_000;
/** Consecutive clean evaluations before an open insight resolves. */
export const CLEAR_STREAK_TO_RESOLVE = 2;
