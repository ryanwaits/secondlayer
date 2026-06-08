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
 */

const FRESH_MS = 60_000; // treat cache as fresh for 60s
const MAX_STALE_MS = 10 * 60_000; // keep serving last-known up to 10m if the feed is down
const FETCH_TIMEOUT_MS = 3_000;

// CoinGecko simple-price (STX is `blockstack`). Override the URL via env for a
// different feed (must return `{ bitcoin: { usd }, blockstack: { usd } }`).
const SPOT_URL =
	process.env.X402_SPOT_URL ??
	"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,blockstack&vs_currencies=usd";

type SpotCache = {
	btcUsd: number | null;
	stxUsd: number | null;
	fetchedAt: number;
};
let cache: SpotCache = { btcUsd: null, stxUsd: null, fetchedAt: 0 };
let refreshing = false;

async function refresh(): Promise<void> {
	if (refreshing) return;
	refreshing = true;
	try {
		const res = await fetch(SPOT_URL, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) return;
		const json = (await res.json()) as {
			bitcoin?: { usd?: number };
			blockstack?: { usd?: number };
		};
		const btc = json.bitcoin?.usd;
		const stx = json.blockstack?.usd;
		cache = {
			btcUsd: typeof btc === "number" ? btc : cache.btcUsd,
			stxUsd: typeof stx === "number" ? stx : cache.stxUsd,
			fetchedAt: Date.now(),
		};
	} catch {
		// leave the last-known cache in place
	} finally {
		refreshing = false;
	}
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
 * when the cache is stale and serves the best available value synchronously.
 */
export function spotUsd(symbol: X402TokenSymbol): number | null {
	if (symbol === "USDCx") return 1;
	const age = Date.now() - cache.fetchedAt;
	if (age > FRESH_MS) void refresh(); // fire-and-forget; don't await
	const cached = symbol === "sBTC" ? cache.btcUsd : cache.stxUsd;
	if (cached != null && age <= MAX_STALE_MS) return cached;
	return envOverride(symbol); // fallback → override, else null (asset dropped)
}

/** Reset the cache (tests only). */
export function _resetX402SpotForTests(): void {
	cache = { btcUsd: null, stxUsd: null, fetchedAt: 0 };
	refreshing = false;
}

/** Await a cache refresh from the feed (tests only). */
export async function _refreshX402SpotForTests(): Promise<void> {
	await refresh();
}
