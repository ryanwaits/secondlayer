import { ValidationError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { getClientIp } from "../auth/http.ts";

/**
 * `POST /v1/batch` — up to 10 public reads in one round trip.
 *
 * Built for LLM agents, which pay per round trip in both latency and tokens.
 * Each item re-dispatches through the full app pipeline (auth, quotas,
 * rate limits all apply per item), so this is purely a transport optimization
 * — no payment or permission semantics change. Forwarded Authorization
 * applies to every item.
 */

export const BATCH_MAX_ITEMS = 10;

const ALLOWED_PREFIXES = [
	"/v1/index/",
	"/v1/subgraphs",
	"/v1/streams/",
	"/v1/contracts",
];

const FORWARDED_HEADERS = ["authorization"] as const;

type BatchItem = {
	path: string;
	params?: Record<string, string | number | boolean>;
};

export type BatchDispatch = (
	path: string,
	init: { headers: Record<string, string> },
	/** The batch request itself, so a dispatcher can carry its audience
	 *  (an MCP-made batch makes MCP-made items: auth/oauth/audience.ts). */
	parent: Request,
) => Promise<Response>;

/** Escapes that could still turn into a dot, a slash or a backslash once a
 *  router or handler decodes the path: refused rather than guessed at. */
const ENCODED_SEPARATOR = /%(?:2e|2f|5c|25)/i;

/**
 * The exact path and query a batch item dispatches to, or null when it is not
 * allowed. The check runs on the path as the URL parser resolves it, which
 * is what the dispatcher fetches: `..` and `%2e%2e` segments are already
 * collapsed, so a prefix check on the raw string can't be walked out of.
 */
export function normalizeBatchPath(raw: string): string | null {
	if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\"))
		return null;
	let url: URL;
	try {
		url = new URL(raw, "http://batch.invalid");
	} catch {
		return null;
	}
	if (url.origin !== "http://batch.invalid") return null;
	const path = url.pathname;
	if (path.includes("..") || ENCODED_SEPARATOR.test(path)) return null;
	if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) return null;
	return `${path}${url.search}`;
}

export function createBatchRouter(dispatch: BatchDispatch) {
	const router = new Hono();

	router.post("/", async (c) => {
		const body = (await c.req.json().catch(() => null)) as {
			requests?: BatchItem[];
		} | null;
		const requests = body?.requests;
		if (!Array.isArray(requests) || requests.length === 0) {
			throw new ValidationError(
				"Body must be { requests: [{ path, params? }] }",
			);
		}
		if (requests.length > BATCH_MAX_ITEMS) {
			throw new ValidationError(
				`At most ${BATCH_MAX_ITEMS} requests per batch`,
			);
		}

		const headers: Record<string, string> = {
			// Quotas and rate limits key on the real caller, not the dispatcher.
			"x-forwarded-for": getClientIp(c),
		};
		for (const name of FORWARDED_HEADERS) {
			const value = c.req.header(name);
			if (value) headers[name] = value;
		}

		const results = await Promise.all(
			requests.map(async (item) => {
				const target =
					typeof item?.path === "string" ? normalizeBatchPath(item.path) : null;
				if (!target) {
					return {
						path: item?.path ?? null,
						status: 400,
						body: {
							error: "Path not allowed in batch (public /v1 reads only)",
							code: "VALIDATION_ERROR",
						},
					};
				}
				const qs = item.params
					? `${target.includes("?") ? "&" : "?"}${new URLSearchParams(
							Object.fromEntries(
								Object.entries(item.params).map(([k, v]) => [k, String(v)]),
							),
						).toString()}`
					: "";
				try {
					const res = await dispatch(`${target}${qs}`, { headers }, c.req.raw);
					const parsed = await res
						.json()
						.catch(() => ({ error: "non-JSON response" }));
					return { path: item.path, status: res.status, body: parsed };
				} catch {
					return {
						path: item.path,
						status: 500,
						body: { error: "batch item failed", code: "INTERNAL_ERROR" },
					};
				}
			}),
		);

		return c.json({ results });
	});

	return router;
}
