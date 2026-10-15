/**
 * Last line of defense for analytics: no event leaves the browser with an API
 * key in it. The docs key's slots are already blocked from autocapture and
 * replay (`ph-no-capture`); this scrubs anything that still carries one (an
 * element's text, an exception message, a URL) before PostHog sends it.
 */
const KEY = /sk-(?:sl|snt)_[0-9a-f]{16,}/g;
const REDACTED = "sk-sl_[redacted]";
const MAX_DEPTH = 12;

function scrub(value: unknown, depth: number): unknown {
	if (typeof value === "string") return value.replace(KEY, REDACTED);
	if (depth > MAX_DEPTH || value === null || typeof value !== "object")
		return value;
	if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
	// Only plain objects are rebuilt. A Date (the event's `timestamp`) or any
	// other instance passes through as is: rebuilding one leaves `{}`, and
	// PostHog rejects the whole batch for it.
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return value;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value)) out[k] = scrub(v, depth + 1);
	return out;
}

/** PostHog `before_send`: the event with every API key replaced. */
export function redactKeys<T>(event: T): T {
	return scrub(event, 0) as T;
}
