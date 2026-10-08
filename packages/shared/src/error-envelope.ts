/**
 * Pure, dependency-free pieces of the API error envelope: request ids,
 * default codes by status, feedback pointers and query redaction. Shared by
 * the API middleware and the workload gateway so both emit the same shape.
 */

/** Default `code` for an error body that set none, keyed by HTTP status. */
export const DEFAULT_CODE_BY_STATUS: Record<number, string> = {
	400: "VALIDATION_ERROR",
	401: "AUTHENTICATION_ERROR",
	402: "PAYMENT_REQUIRED",
	403: "FORBIDDEN",
	404: "NOT_FOUND",
	409: "CONFLICT",
	410: "GONE",
	415: "UNSUPPORTED_MEDIA_TYPE",
	422: "VALIDATION_ERROR",
	429: "RATE_LIMIT_ERROR",
	500: "INTERNAL_ERROR",
	502: "UPSTREAM_ERROR",
	503: "SERVICE_UNAVAILABLE",
};

/** Where to report a gap: a path on hosted, the issue tracker on self-host. */
export const FEEDBACK_URL = {
	platform: "/v1/feedback",
	oss: "https://github.com/ryanwaits/secondlayer/issues/new",
} as const;

/** One hosted failed-request record (account-scoped, kept 24h). */
export type FailedRequestRecord = {
	request_id: string;
	account_id: string;
	method: string;
	path: string;
	status: number;
	code: string;
	message: string;
	query: Record<string, unknown>;
	origin: string | null;
};

/** Incoming `X-Request-Id` values matching this are reused. */
export const REQUEST_ID_PATTERN: RegExp = /^[A-Za-z0-9._-]{8,64}$/;

/** `req_` plus 24 lowercase hex chars. */
export function newRequestId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	let hex = "";
	for (const b of bytes) hex += b.toString(16).padStart(2, "0");
	return `req_${hex}`;
}

const SENSITIVE_KEY = /token|key|secret|signature|password|auth/i;
const MAX_VALUE_CHARS = 200;
const MAX_QUERY_JSON_CHARS = 2048;

/**
 * Query params safe to store: sensitive keys dropped, values capped at 200
 * chars, and a `{ _truncated, keys }` stub when the result is over 2048 chars.
 */
export function redactQuery(params: URLSearchParams): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of params) {
		if (SENSITIVE_KEY.test(key)) continue;
		out[key] = value.slice(0, MAX_VALUE_CHARS);
	}
	if (JSON.stringify(out).length > MAX_QUERY_JSON_CHARS) {
		return { _truncated: true, keys: Object.keys(out) };
	}
	return out;
}

/**
 * Additive error body: `request_id` always set, `code` only when absent or
 * not a string, `feedback` only when absent (or always with
 * `overrideFeedback`). Returns null when `body` is not an object carrying an
 * `error` key, so callers leave such responses alone.
 */
export function augmentErrorBody(
	body: unknown,
	opts: {
		status: number;
		requestId: string;
		feedbackUrl: string;
		overrideFeedback?: boolean;
	},
): Record<string, unknown> | null {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return null;
	}
	if (!("error" in body)) return null;
	const src = body as Record<string, unknown>;
	const next: Record<string, unknown> = { ...src, request_id: opts.requestId };
	if (typeof src.code !== "string") {
		next.code = DEFAULT_CODE_BY_STATUS[opts.status] ?? "HTTP_ERROR";
	}
	if (opts.overrideFeedback || src.feedback === undefined) {
		next.feedback = { url: opts.feedbackUrl };
	}
	return next;
}
