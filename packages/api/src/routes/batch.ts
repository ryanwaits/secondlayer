import { ValidationError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { getClientIp } from "../auth/http.ts";

/**
 * `POST /v1/batch` — up to 10 public reads in one round trip.
 *
 * Built for LLM agents, which pay per round trip in both latency and tokens.
 * Each item re-dispatches through the full app pipeline (auth, quotas, x402,
 * rate limits all apply per item), so this is purely a transport optimization
 * — no payment or permission semantics change. Forwarded credentials
 * (Authorization, PAYMENT-BALANCE, PAYMENT-SESSION) apply to every item;
 * a prepaid balance token makes the whole batch settle off the tab.
 */

export const BATCH_MAX_ITEMS = 10;

const ALLOWED_PREFIXES = [
	"/v1/index/",
	"/v1/subgraphs",
	"/v1/streams/",
	"/v1/contracts",
	"/v1/x402/supported",
];

const FORWARDED_HEADERS = [
	"authorization",
	"payment-balance",
	"payment-session",
] as const;

type BatchItem = {
	path: string;
	params?: Record<string, string | number | boolean>;
};

export type BatchDispatch = (
	path: string,
	init: { headers: Record<string, string> },
) => Promise<Response>;

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
				if (
					typeof item?.path !== "string" ||
					!ALLOWED_PREFIXES.some((p) => item.path.startsWith(p)) ||
					item.path.includes("..")
				) {
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
					? `${item.path.includes("?") ? "&" : "?"}${new URLSearchParams(
							Object.fromEntries(
								Object.entries(item.params).map(([k, v]) => [k, String(v)]),
							),
						).toString()}`
					: "";
				try {
					const res = await dispatch(`${item.path}${qs}`, { headers });
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
