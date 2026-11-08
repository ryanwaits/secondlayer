/**
 * How a dashboard read ends, shared by the browser fetchers (through the
 * `/api/*` proxies) and the server reads (straight to the platform API). A
 * starting hosted stack, an asleep one and a zero balance are expected states
 * here, not errors, so both sides map status codes to the same few kinds.
 */

export type WebhooksResult<T> =
	| { kind: "ok"; data: T }
	| { kind: "starting"; retryAfter: number }
	/** The stack stopped while nothing used it; reads don't restart it. */
	| { kind: "asleep" }
	| { kind: "no_credits" }
	| { kind: "rate_limited"; retryAfter: number }
	| { kind: "not_found" }
	| { kind: "error"; message: string };

/** Pure status → result-kind mapping. Returns `null` for a 2xx, meaning the
 *  caller should read the response body as the success payload. */
export function resultForStatus(
	status: number,
	retryAfterHeader: string | null,
	errorMessage: string,
	/** The API's `code`; a stopped stack is told apart by it, never by message text. */
	code?: string,
): WebhooksResult<never> | null {
	if (status >= 200 && status < 300) return null;
	const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : 30;
	if (status === 503 && code === "STACK_ASLEEP") return { kind: "asleep" };
	if (status === 503) return { kind: "starting", retryAfter };
	if (status === 402) return { kind: "no_credits" };
	if (status === 429) return { kind: "rate_limited", retryAfter };
	if (status === 404) return { kind: "not_found" };
	return { kind: "error", message: errorMessage };
}

/** The API's `{ error }` text, or a status-only message. */
export function errorMessageOf(body: unknown, status: number): string {
	return body &&
		typeof body === "object" &&
		"error" in body &&
		typeof (body as { error: unknown }).error === "string"
		? (body as { error: string }).error
		: `Request failed (${status})`;
}

/** The API's `{ code }` string, when the body has one. */
export function errorCodeOf(body: unknown): string | undefined {
	return body &&
		typeof body === "object" &&
		"code" in body &&
		typeof (body as { code: unknown }).code === "string"
		? (body as { code: string }).code
		: undefined;
}

/** A response and its parsed JSON body (`null` when it had none) as a result. */
export function resultFromResponse<T>(
	res: Pick<Response, "status" | "headers">,
	body: unknown,
): WebhooksResult<T> {
	const mapped = resultForStatus(
		res.status,
		res.headers.get("Retry-After"),
		errorMessageOf(body, res.status),
		errorCodeOf(body),
	);
	if (mapped) return mapped;
	// A 2xx with no readable body has no payload to hand the page.
	if (body === null || body === undefined) {
		return { kind: "error", message: "Couldn't reach the API" };
	}
	return { kind: "ok", data: body as T };
}

/** The notice a page starts with from its server read. A server read that
 *  failed (in practice, one that timed out) is no notice: the browser retries
 *  at once, so the page shows its skeleton until that retry itself fails.
 *  `noticeFor` is the page's own read-to-notice mapping. */
export function initialNotice<T, N>(
	res: WebhooksResult<T>,
	noticeFor: (res: WebhooksResult<T>) => N | null | undefined,
): N | null {
	return res.kind === "error" ? null : (noticeFor(res) ?? null);
}
