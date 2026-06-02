import {
	IMMUTABLE_CACHE_CONTROL,
	MUTABLE_CACHE_CONTROL,
	cacheControl,
	etag,
	matchesIfNoneMatch,
} from "../http/cache.ts";
import { parseStreamsEventsQuery } from "./events.ts";
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
): { cacheControl: string; cacheKey: string | null } {
	const parsed = parseStreamsEventsQuery(query, tip);
	const fullyFinalized =
		!parsed.cursorPastTip && parsed.toHeight <= tip.finalized_height;
	const cacheKey = fullyFinalized
		? JSON.stringify({
				f: parsed.fromHeight ?? null,
				t: parsed.toHeight,
				ty: parsed.types ? [...parsed.types].sort() : null,
				c: parsed.contractId ?? null,
				s: parsed.sender ?? null,
				r: parsed.recipient ?? null,
				a: parsed.assetIdentifier ?? null,
				l: parsed.limit,
				cur: parsed.cursorRaw ?? null,
			})
		: null;
	return { cacheControl: streamsCacheControl(fullyFinalized), cacheKey };
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
