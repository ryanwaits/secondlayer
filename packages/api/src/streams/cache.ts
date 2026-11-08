import {
	IMMUTABLE_CACHE_CONTROL,
	MUTABLE_CACHE_CONTROL,
	cacheControl,
	etag,
	matchesIfNoneMatch,
} from "../http/cache.ts";
import { type StreamsEventsQuery, parseStreamsEventsQuery } from "./events.ts";
import type { StreamsTier } from "./tiers.ts";
import type { StreamsTip } from "./tip.ts";

/**
 * Caching for Streams reads, gated on finality. Built on the generic
 * `http/cache.ts` primitives; this module adds the Streams-specific finality
 * decision (resolved `to_height` vs `tip.finalized_height`).
 *
 * A page is immutable only when every row it can contain is past the
 * burn-confirmation finality boundary — i.e. its resolved `to_height` is at or
 * below `tip.finalized_height`. Such pages are deterministic forever and get a
 * long-lived `immutable` directive. Anything that can still reorg (the default
 * tip-spanning request) gets a short private TTL so a shared cache never serves
 * stale tip data across tenants.
 */
export const STREAMS_IMMUTABLE_CACHE_CONTROL = IMMUTABLE_CACHE_CONTROL;
export const STREAMS_MUTABLE_CACHE_CONTROL = MUTABLE_CACHE_CONTROL;

export function streamsCacheControl(fullyFinalized: boolean): string {
	return cacheControl(fullyFinalized);
}

/** True when a finite height is at or below the finality boundary. */
export function isFinalizedHeight(
	height: number | undefined,
	tip: StreamsTip,
): boolean {
	return height !== undefined && height <= tip.finalized_height;
}

/**
 * Cache directive for a `/v1/streams/events` request. Immutable only when the
 * resolved range ends at or below the finality boundary and the cursor is not
 * past the tip. Re-parses the query (pure, cheap) so the handler can decide
 * without threading the resolved range through the response envelope.
 */
/**
 * Cache decision for a `/events` request, computed in one parse: the
 * `Cache-Control` directive plus an origin-cache key (non-null only for
 * finalized/immutable pages). The key is derived from the resolved range so
 * different URLs that resolve to the same page share an entry; it deliberately
 * excludes tenant/auth, since finalized content is identical across tenants.
 */
export function streamsEventsCachePlan(
	query: URLSearchParams,
	tip: StreamsTip,
	tier?: StreamsTier,
): { cacheControl: string; cacheKey: string | null } {
	const parsed = parseStreamsEventsQuery(query, tip, tier);
	const fullyFinalized =
		!parsed.cursorPastTip && parsed.toHeight <= tip.finalized_height;
	const cacheKey = fullyFinalized ? streamsCacheKey(parsed) : null;
	return { cacheControl: streamsCacheControl(fullyFinalized), cacheKey };
}

/**
 * Parsed-query fields that are deliberately NOT part of the cache key.
 * Everything else in the parsed query is, so a parameter added later forks the
 * key by default; opting a field out is a decision made here, not forgotten.
 *
 * - `cursor`: the decoded form of `cursorRaw`, which is keyed.
 * - `cursorPastTip`: derived from fields that are keyed, and always false for
 *   a finalized page.
 */
export const STREAMS_CACHE_KEY_EXCLUDED = ["cursor", "cursorPastTip"] as const;

/**
 * Origin-cache key for a finalized page: every parsed field except the
 * excluded ones, in a canonical form (sets sorted, object keys sorted) so
 * equivalent requests share an entry and different pages never do. Labels in
 * `filters` are part of the key because they ride back on every row as
 * `matched`; so is `clock`, since the two clocks read different tables.
 */
export function streamsCacheKey(parsed: StreamsEventsQuery): string {
	const excluded: ReadonlySet<string> = new Set(STREAMS_CACHE_KEY_EXCLUDED);
	const fields = Object.entries(parsed)
		.filter(([name]) => !excluded.has(name))
		.sort(([a], [b]) => (a < b ? -1 : 1));
	return JSON.stringify(
		fields.map(([name, value]) => [name, canonicalValue(value)]),
	);
}

function canonicalValue(value: unknown): unknown {
	if (value === undefined) return null;
	if (Array.isArray(value)) {
		return value.map(canonicalValue).sort((a, b) => {
			const x = JSON.stringify(a);
			const y = JSON.stringify(b);
			return x < y ? -1 : x > y ? 1 : 0;
		});
	}
	if (value !== null && typeof value === "object") {
		return Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([k, v]) => [k, canonicalValue(v)]);
	}
	return value;
}

export function streamsEventsCacheControl(
	query: URLSearchParams,
	tip: StreamsTip,
): string {
	return streamsEventsCachePlan(query, tip).cacheControl;
}

/** Weak ETag over a response body. Immutable pages hash to a stable value. */
export function streamsETag(body: string): string {
	return etag(body);
}

export { matchesIfNoneMatch };
