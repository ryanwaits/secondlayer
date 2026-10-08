import { logger } from "@secondlayer/shared";
import {
	DEFAULT_CODE_BY_STATUS,
	FEEDBACK_URL,
	type FailedRequestRecord,
	augmentErrorBody,
	redactQuery,
} from "@secondlayer/shared/error-envelope";
import type { InstanceMode } from "@secondlayer/shared/mode";
import type { Context, MiddlewareHandler } from "hono";
import { getRequestId } from "./request-id.ts";

export { DEFAULT_CODE_BY_STATUS, FEEDBACK_URL, redactQuery };
export type { FailedRequestRecord };

const MAX_MESSAGE_CHARS = 200;

/** Account behind this request, once auth resolved one (hosted only). */
export function resolveAccountId(c: Context): string | undefined {
	const direct = c.get("accountId") as string | undefined;
	if (direct) return direct;
	const index = c.get("indexTenant") as { account_id?: string } | undefined;
	if (index?.account_id) return index.account_id;
	const streams = c.get("streamsTenant") as { account_id?: string } | undefined;
	return streams?.account_id;
}

// Throttle recorder failures so a DB outage doesn't log once per request.
let lastRecordFailLogMs = 0;
function warnRecordFailure(err: unknown): void {
	const now = Date.now();
	if (now - lastRecordFailLogMs < 60_000) return;
	lastRecordFailLogMs = now;
	logger.warn("Failed-request record write failed", {
		error: err instanceof Error ? err.message : String(err),
	});
}

/**
 * Makes every JSON error body carry `request_id`, `code` and
 * `feedback.url` (additive only), and on hosted hands a copy of the failure
 * to `record` without awaiting it. Mount outermost, after `requestId()`.
 */
export function errorEnvelope(opts: {
	mode: InstanceMode;
	record?: (row: FailedRequestRecord) => Promise<void>;
}): MiddlewareHandler {
	const feedbackUrl = FEEDBACK_URL[opts.mode];
	const record = opts.mode === "platform" ? opts.record : undefined;
	return async (c, next) => {
		await next();
		const res = c.res;
		const id = getRequestId(c);
		if (!id || res.status < 400) return;
		if (!res.headers.get("content-type")?.includes("application/json")) return;

		let body: unknown;
		try {
			body = await res.clone().json();
		} catch {
			return;
		}
		const augmented = augmentErrorBody(body, {
			status: res.status,
			requestId: id,
			feedbackUrl,
		});
		if (!augmented) return;

		const headers = new Headers(res.headers);
		headers.delete("content-length");
		c.res = new Response(JSON.stringify(augmented), {
			status: res.status,
			headers,
		});

		if (!record || res.status === 429) return;
		const accountId = resolveAccountId(c);
		if (!accountId) return;
		const row: FailedRequestRecord = {
			request_id: id,
			account_id: accountId,
			method: c.req.method,
			path: c.req.path,
			status: res.status,
			code: augmented.code as string,
			message:
				typeof augmented.error === "string"
					? augmented.error.slice(0, MAX_MESSAGE_CHARS)
					: "",
			query: redactQuery(new URL(c.req.url).searchParams),
			origin: c.req.header("x-sl-origin")?.toLowerCase() ?? null,
		};
		// Fire-and-forget: never delays or alters the response.
		void (async () => record(row))().catch(warnRecordFailure);
	};
}
