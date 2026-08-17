import type { MiddlewareHandler } from "hono";

/**
 * CSRF guard for the write plane: refuse writes a browser could have forged.
 *
 * The hole this closes is CORS, not auth. A cross-origin `fetch` only gets a
 * preflight — and therefore only gets stopped by our CORS policy — when it is
 * *not* a "simple request". A POST is simple when its Content-Type is one of
 * `text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`, or
 * when it carries no Content-Type at all (a `Uint8Array`/`ArrayBuffer`/empty
 * `Blob` body sets no header, and a body-less POST sets none either). Those
 * requests are *delivered*. The attacker never reads the response, but the
 * deploy already ran, the schema was already dropped, the webhook already
 * fired.
 *
 * `c.req.json()` happily parses any of them — it does not look at
 * Content-Type — so nothing downstream notices. This middleware is the thing
 * that notices.
 *
 * The rule, stated as the attacker sees it: a write must carry a header a
 * browser cannot set cross-origin without our permission. `Content-Type:
 * application/json` is exactly that header. Every first-party caller (CLI,
 * SDK, MCP, the web app) already sends it on every write.
 *
 * Why this matters on a self-host: `POST /api/subgraphs` deploys handler code
 * that the processor `await import()`s and runs in-process. With
 * `INSTANCE_TOKEN` set, the missing bearer token already stops a drive-by; run
 * tokenless (bare `bun run start`, devnet, a cleared token) and this guard is
 * the only thing between a visited web page and code execution on the
 * operator's box.
 */

/** Error code → 415, mapped in shared `CODE_TO_STATUS`. */
export const UNSUPPORTED_MEDIA_TYPE = "UNSUPPORTED_MEDIA_TYPE";

/**
 * Methods that can carry a body. `POST` is the only one a browser can send
 * cross-origin without a preflight (`PUT`/`PATCH`/`DELETE` are not
 * CORS-safelisted methods, so the CORS policy already gates them). The other
 * three are guarded anyway, but only when they carry a payload — belt to the
 * preflight's braces, without breaking body-less `DELETE`.
 */
const GUARDED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `POST /api/webhooks/stripe` is called by Stripe, not by a browser and not by
 * us. It authenticates with an HMAC over the raw bytes (`stripe-signature`),
 * which is a strictly stronger check than any header shape, and its
 * Content-Type is Stripe's to choose. Guarding it would buy nothing and risk
 * dropping paid events.
 */
const EXEMPT_PREFIXES = ["/api/webhooks"];

export class UnsupportedMediaTypeError extends Error {
	readonly code = UNSUPPORTED_MEDIA_TYPE;
	readonly details: Record<string, unknown>;

	constructor(received: string | null) {
		super("Writes require Content-Type: application/json");
		this.name = "UnsupportedMediaTypeError";
		this.details = {
			hint: "This endpoint changes state, so it accepts a JSON body and nothing else. Send `Content-Type: application/json` (parameters such as `; charset=utf-8` are fine). text/plain, application/x-www-form-urlencoded, multipart/form-data and a missing Content-Type are refused on purpose: they are the shapes a browser can send cross-origin without a CORS preflight, so honoring them would let any page the operator visits drive this API.",
			header: "Content-Type: application/json",
			received,
		};
	}
}

/** `application/json`, with or without parameters. Nothing else. */
export function isJsonContentType(value: string | null | undefined): boolean {
	if (!value) return false;
	const essence = value.split(";")[0]?.trim().toLowerCase();
	return essence === "application/json";
}

function isExempt(path: string): boolean {
	return EXEMPT_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(`${prefix}/`),
	);
}

/** Whether this request carries a payload at all. A body-less POST is how the
 *  console proxy and the SDK invoke action routes (`/stop`, `/pause`,
 *  `/rotate-secret`), and how `reindex` is called with no options. */
function hasBody(contentLength: string | undefined, body: unknown): boolean {
	if (contentLength === "0") return false;
	return body !== null && body !== undefined;
}

/**
 * Reject writes a browser could have sent without a preflight.
 *
 * - Content-Type present → must be `application/json`.
 * - Content-Type absent  → allowed only when the request carries no payload
 *   *and* no `Origin` header. The inline comment below says why both halves
 *   are needed.
 */
export function requireJsonWrites(): MiddlewareHandler {
	return async (c, next) => {
		const method = c.req.method.toUpperCase();
		if (!GUARDED_METHODS.has(method) || isExempt(c.req.path)) {
			await next();
			return;
		}

		const received = c.req.header("content-type") ?? null;
		if (received !== null) {
			if (!isJsonContentType(received))
				throw new UnsupportedMediaTypeError(received);
			await next();
			return;
		}

		// No Content-Type. Two independent reasons a browser could be behind it:
		//
		//  - it sent a payload as bytes (`body: new Uint8Array(...)` sets no
		//    header and still parses as JSON server-side), or
		//  - it sent a body-less action POST — `/subscriptions/:id/test` fires an
		//    outbound request to a caller-chosen URL and reads no body at all.
		//
		// The first is caught by "carries a payload". The second is caught by the
		// `Origin` header, which the Fetch spec requires on every cross-origin
		// request and on every request whose method is not GET/HEAD — so a
		// browser cannot omit it, and a server-to-server caller never sends it.
		// Anything failing both tests is not browser-shaped, and body-less writes
		// from the console proxy and the SDK keep working.
		const payload = hasBody(c.req.header("content-length"), c.req.raw.body);
		const browserShaped = c.req.header("origin") !== undefined;
		if (payload || browserShaped) throw new UnsupportedMediaTypeError(null);
		await next();
	};
}
