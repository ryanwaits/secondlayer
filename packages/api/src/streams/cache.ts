import { createHash } from "node:crypto";
import { parseStreamsEventsQuery } from "./events.ts";
import type { StreamsTip } from "./tip.ts";

/**
 * Caching for Streams reads, gated on finality.
 *
 * A page is immutable only when every row it can contain is past the
 * burn-confirmation finality boundary — i.e. its resolved `to_height` is at or
 * below `tip.finalized_height`. Such pages are deterministic forever and get a
 * long-lived `immutable` directive. Anything that can still reorg (the default
 * tip-spanning request) gets a short private TTL so a shared cache never serves
 * stale tip data across tenants.
 */
export const STREAMS_IMMUTABLE_CACHE_CONTROL =
	"public, max-age=31536000, immutable";
export const STREAMS_MUTABLE_CACHE_CONTROL = "private, max-age=2";

export function streamsCacheControl(fullyFinalized: boolean): string {
	return fullyFinalized
		? STREAMS_IMMUTABLE_CACHE_CONTROL
		: STREAMS_MUTABLE_CACHE_CONTROL;
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
export function streamsEventsCacheControl(
	query: URLSearchParams,
	tip: StreamsTip,
): string {
	const parsed = parseStreamsEventsQuery(query, tip);
	const fullyFinalized =
		!parsed.cursorPastTip && parsed.toHeight <= tip.finalized_height;
	return streamsCacheControl(fullyFinalized);
}

/** Weak ETag over a response body. Immutable pages hash to a stable value. */
export function streamsETag(body: string): string {
	return `W/"${createHash("sha256").update(body).digest("base64url")}"`;
}

/**
 * Conditional-request match. Honors `*` and weak comparison (RFC 7232 §3.2:
 * `If-None-Match` always uses the weak comparison function), so `W/"x"` and
 * `"x"` match.
 */
export function matchesIfNoneMatch(
	ifNoneMatch: string | null | undefined,
	etag: string,
): boolean {
	if (!ifNoneMatch) return false;
	if (ifNoneMatch.trim() === "*") return true;
	const normalize = (tag: string) => tag.trim().replace(/^W\//, "");
	const target = normalize(etag);
	return ifNoneMatch.split(",").some((tag) => normalize(tag) === target);
}
