import { createHash } from "node:crypto";

/**
 * Generic HTTP caching primitives shared across read surfaces (Streams, Index).
 *
 * A page is cacheable-forever only when every row it can contain is past the
 * chain's finality boundary — such pages are deterministic and get a long-lived
 * `immutable` directive. Anything that can still reorg gets a short private TTL
 * so a shared cache never serves stale tip data across tenants. The finality
 * decision is surface-specific (it depends on the resolved height window), so it
 * lives with each surface; these helpers only encode the directives, ETag, and
 * conditional-request matching every surface reuses.
 */

/** Long-lived directive for finalized/immutable pages. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** Short private TTL for pages that can still change (tip-spanning). */
export const MUTABLE_CACHE_CONTROL = "private, max-age=2";

export function cacheControl(fullyFinalized: boolean): string {
	return fullyFinalized ? IMMUTABLE_CACHE_CONTROL : MUTABLE_CACHE_CONTROL;
}

/** Weak ETag over a response body. Immutable pages hash to a stable value. */
export function etag(body: string): string {
	return `W/"${createHash("sha256").update(body).digest("base64url")}"`;
}

/**
 * Conditional-request match. Honors `*` and weak comparison (RFC 7232 §3.2:
 * `If-None-Match` always uses the weak comparison function), so `W/"x"` and
 * `"x"` match.
 */
export function matchesIfNoneMatch(
	ifNoneMatch: string | null | undefined,
	tag: string,
): boolean {
	if (!ifNoneMatch) return false;
	if (ifNoneMatch.trim() === "*") return true;
	const normalize = (value: string) => value.trim().replace(/^W\//, "");
	const target = normalize(tag);
	return ifNoneMatch.split(",").some((value) => normalize(value) === target);
}
