import { getErrorMessage, logger } from "@secondlayer/shared";
import type { X402TokenSymbol } from "@secondlayer/shared/x402";

/**
 * Live USD spot prices for pricing non-stable x402 assets (sBTC→BTC/USD,
 * STX→STX/USD). USDCx needs no spot (dollar peg, handled in `buildAccepts`).
 *
 * Stale-while-revalidate + non-blocking: `spotUsd()` reads an in-process cache
 * synchronously and never blocks a request on the upstream feed. On a stale read
 * it fires a background refresh and serves the last-known value (up to a max
 * staleness). Fallback chain: live cache → `X402_SPOT_<SYM>_USD` env override →
 * `null`. A `null` means "can't price this asset right now" → the caller omits it
 * from `accepts[]`, so the offer degrades to **USDCx-only** rather than mispricing.
 *
 * Refresh cadence is gated SEPARATELY from data staleness via `nextAttemptAt`.
 * A successful fetch defers the next attempt by `FRESH_MS`; a FAILED fetch only
 * defers by a short backoff (`RETRY_MS`, or the 429 `Retry-After`). This is the
 * fix for the prod retry storm: previously a failure never advanced the "last
 * fetched" clock, so every request re-fired a refresh and hammered CoinGecko
 * into a sustained 429 (it rate-limits after ~5 rapid calls), which the cache
 * never recovered from. Failures are now throttled and logged (debounced).
 */

// CoinGecko free tier rate-limits hard (~5 rapid calls → 429), so refresh on a
// coarse cadence — STX/BTC don't move enough in 5m to matter for sub-cent pricing.
const FRESH_MS = 5 * 60_000; // serve a successful value as fresh for 5m
const RETRY_MS = 30_000; // after a failed attempt, wait this long before retrying
const MAX_STALE_MS = 30 * 60_000; // keep serving last-known up to 30m if the feed is down
const FETCH_TIMEOUT_MS = 3_000;
const WARN_DEBOUNCE_MS = 60_000; // at most one feed-failure warn per minute

// CoinGecko simple-price (STX is `blockstack`). Override the URL via env for a
// different feed (must return `{ bitcoin: { usd }, blockstack: { usd } }`) — e.g.
// an authenticated CoinGecko Pro endpoint to dodge the free-tier rate limit.
const SPOT_URL =
	process.env.X402_SPOT_URL ??
	"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,blockstack&vs_currencies=usd";

type SpotCache = {
	btcUsd: number | null;
	stxUsd: number | null;
	fetchedAt: number;
};
let cache: SpotCache = { btcUsd: null, stxUsd: null, fetchedAt: 0 };
let nextAttemptAt = 0; // earliest time we're allowed to hit the feed again
let refreshing = false;
let lastWarnAt = 0;

function warnFeed(message: string, extra?: Record<string, unknown>): void {
	const now = Date.now();
	if (now - lastWarnAt < WARN_DEBOUNCE_MS) return;
	lastWarnAt = now;
	logger.warn(message, extra);
}

async function refresh(): Promise<void> {
	if (refreshing) return;
	refreshing = true;
	// Pessimistic floor set up front: even a thrown fetch leaves a RETRY_MS
	// backoff so a failing feed can't be re-fired on every request.
	nextAttemptAt = Date.now() + RETRY_MS;
	try {
		const res = await fetch(SPOT_URL, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (res.status === 429) {
			const retryAfterRaw = res.headers.get("retry-after");
			const retryAfterSec = Number(retryAfterRaw);
			const backoffMs =
				Number.isFinite(retryAfterSec) && retryAfterSec > 0
					? retryAfterSec * 1000
					: RETRY_MS;
			nextAttemptAt = Date.now() + Math.max(RETRY_MS, backoffMs);
			warnFeed("x402 spot feed rate-limited (429)", {
				retryAfter: retryAfterRaw,
			});
			return;
		}
		if (!res.ok) {
			warnFeed("x402 spot feed returned non-ok", { status: res.status });
			return;
		}
		const json = (await res.json()) as {
			bitcoin?: { usd?: number };
			blockstack?: { usd?: number };
		};
		const btc = json.bitcoin?.usd;
		const stx = json.blockstack?.usd;
		if (typeof btc !== "number" && typeof stx !== "number") {
			warnFeed("x402 spot feed returned no usable prices");
			return;
		}
		cache = {
			btcUsd: typeof btc === "number" ? btc : cache.btcUsd,
			stxUsd: typeof stx === "number" ? stx : cache.stxUsd,
			fetchedAt: Date.now(),
		};
		nextAttemptAt = Date.now() + FRESH_MS; // success → coarse cadence
	} catch (err) {
		warnFeed("x402 spot feed fetch failed", { error: getErrorMessage(err) });
		// RETRY_MS floor from the top of the function still stands.
	} finally {
		refreshing = false;
	}
}

function shouldRefresh(now: number): boolean {
	if (refreshing) return false;
	if (now < nextAttemptAt) return false; // backoff / cadence floor
	return now - cache.fetchedAt > FRESH_MS; // data is stale
}

function envOverride(symbol: X402TokenSymbol): number | null {
	const key =
		symbol === "sBTC"
			? "X402_SPOT_SBTC_USD"
			: symbol === "STX"
				? "X402_SPOT_STX_USD"
				: null;
	if (!key) return null;
	const raw = process.env[key];
	const parsed = raw ? Number(raw) : Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * USD per 1 whole token, or `null` if it can't be priced now (→ omit the asset).
 * USDCx returns 1 (the dollar peg). Never blocks: triggers a background refresh
 * when the cache is stale (and the backoff has elapsed) and serves the best
 * available value synchronously.
 */
export function spotUsd(symbol: X402TokenSymbol): number | null {
	if (symbol === "USDCx") return 1;
	const now = Date.now();
	if (shouldRefresh(now)) void refresh(); // fire-and-forget; don't await
	const cached = symbol === "sBTC" ? cache.btcUsd : cache.stxUsd;
	if (cached != null && now - cache.fetchedAt <= MAX_STALE_MS) return cached;
	return envOverride(symbol); // fallback → override, else null (asset dropped)
}

/**
 * Prime the cache once at startup so the first 402s carry live prices instead of
 * the env fallback. Best-effort and non-blocking-safe: errors are already logged
 * inside `refresh()`, and the backoff handles retry.
 */
export async function primeSpot(): Promise<void> {
	await refresh();
}

/** Reset the cache (tests only). */
export function _resetX402SpotForTests(): void {
	cache = { btcUsd: null, stxUsd: null, fetchedAt: 0 };
	nextAttemptAt = 0;
	lastWarnAt = 0;
	refreshing = false;
}

/** Await a cache refresh from the feed (tests only). */
export async function _refreshX402SpotForTests(): Promise<void> {
	await refresh();
}
