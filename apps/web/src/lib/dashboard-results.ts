/**
 * A starting hosted stack, an asleep one and a zero balance are expected states
 * here, not errors, so both sides map status codes to the same few kinds.
 */

export type WebhooksResult<T> =
	| { kind: "ok"; data: T }
	| { kind: "starting"; retryAfter: number }
	| { kind: "asleep" }
	| { kind: "no_credits" }
	| { kind: "rate_limited"; retryAfter: number }
	| { kind: "not_found" }
	| { kind: "error"; message: string };

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

export function errorMessageOf(body: unknown, status: number): string {
	return body &&
		typeof body === "object" &&
		"error" in body &&
		typeof (body as { error: unknown }).error === "string"
		? (body as { error: string }).error
		: `Request failed (${status})`;
}

export function errorCodeOf(body: unknown): string | undefined {
	return body &&
		typeof body === "object" &&
		"code" in body &&
		typeof (body as { code: unknown }).code === "string"
		? (body as { code: string }).code
		: undefined;
}

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
	if (body === null || body === undefined) {
		return { kind: "error", message: "Couldn't reach the API" };
	}
	return { kind: "ok", data: body as T };
}

/** A server read that failed (in practice, one that timed out) is no notice:
 *  the browser retries at once, so the page shows its skeleton until that
 *  retry itself fails. */
export function initialNotice<T, N>(
	res: WebhooksResult<T>,
	noticeFor: (res: WebhooksResult<T>) => N | null | undefined,
): N | null {
	return res.kind === "error" ? null : (noticeFor(res) ?? null);
}
