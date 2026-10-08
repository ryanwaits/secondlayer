/**
 * The workload host's gateway (Design, step 4): the ONLY thing that ever
 * sees a customer's `sk-sl_*` key. Introspect → resolve the account's
 * tenant stack (provisioning it on the first request) → forward with the
 * stack's own `INSTANCE_TOKEN` swapped in. The customer key never reaches a
 * tenant stack.
 *
 * Routes `/api/webhooks*`, `/api/subgraphs*` and `/v1/subgraphs*`: all three
 * get the same request handling, and the path is forwarded unchanged (there is
 * no path allowlist here; prod's Caddy decides which prefixes reach this host).
 * Reads never provision a tenant; only a write does.
 */

import { logger } from "@secondlayer/shared";
import {
	DEFAULT_CODE_BY_STATUS,
	FEEDBACK_URL,
	type FailedRequestRecord,
	REQUEST_ID_PATTERN,
	augmentErrorBody,
	newRequestId,
	normalizeOrigin,
	redactQuery,
} from "@secondlayer/shared/error-envelope";
import type { TenantState } from "./control-db.ts";
import type { FetchLike } from "./fetch-like.ts";
import type { IntrospectClient } from "./introspect-client.ts";

export interface GatewayDeps {
	introspect: IntrospectClient;
	/** Resolve (and, if missing, start provisioning) a tenant's current
	 *  state. Returning `undefined` means "no tenant yet — kick off
	 *  provisioning and answer 503." */
	resolveTenant: (accountId: string) => Promise<TenantState | undefined>;
	/** `provisioner.up()` — called fire-and-forget on a `none` tenant so the
	 *  first caller doesn't block on the full provision; they get 503 +
	 *  Retry-After and the tenant is `running` by the time they retry. Takes
	 *  only `accountId` — the customer's presented key is NEVER passed to the
	 *  provisioner (Design fix: the provisioner mints its own dedicated
	 *  `hosted-stack` key via `POST /internal/keys/tenant`). */
	startProvisioning: (accountId: string) => void;
	/** `provisioner.start()` — called fire-and-forget on a `stopped` tenant
	 *  whose introspect result just came back `creditsOk: true` (review fix
	 *  3b: a topped-up account must not stay 402'd waiting for the next
	 *  5-minute poll). The caller still gets 503 + Retry-After on THIS
	 *  request; the stack is usually up well before the retry. */
	startTenant: (accountId: string) => void;
	/** `127.0.0.1:<api_port>`-shaped base URL for a running tenant's `api`
	 *  service (review fix: the gateway is a HOST process — it has no
	 *  compose-network DNS, so this can never be a `tenant-<acct8>-api`
	 *  service name), and its `INSTANCE_TOKEN` to swap in. */
	tenantUpstream: (
		accountId: string,
	) => Promise<{ baseUrl: string; instanceToken: string }>;
	fetchImpl?: FetchLike;
	rateLimit?: RateLimiter;
	/** Git sha this process started from, served at `/healthz` so the
	 *  self-upgrade script can confirm a restart landed. Read once at boot;
	 *  `null`/unset when unknown. */
	sha?: string | null;
	/** True while a tenant upgrade round is running; served at `/healthz` so
	 *  the self-upgrade script restarts the service between rounds. */
	isBusy?: () => boolean;
	/** Record one failed request for the account (feedback evidence).
	 *  Fire-and-forget; must never throw or block. */
	recordFailure?: (row: FailedRequestRecord) => void;
}

export interface RateLimitDecision {
	allowed: boolean;
	retryAfterSeconds?: number;
}

/** Per-account, per-bucket rate limiter (Design, step 4's numbers — the
 *  bucket→limit mapping lives on the caller, this just counts). */
export type RateLimiter = (
	accountId: string,
	bucket: string,
) => RateLimitDecision;

function bearerToken(header: string | null): string | null {
	if (!header?.startsWith("Bearer ")) return null;
	const raw = header.slice(7).trim();
	return raw.length > 0 ? raw : null;
}

/** Coarse rate-limit bucket for a webhooks or subgraphs request, matching
 *  the Design's step 4 numbers (create/update/delete 30/min, test 10/min,
 *  replay 5/hour, reads 600/min). Method/path based, so it serves every
 *  prefix the gateway routes. The gateway only classifies; the actual limiter
 *  is injected. */
export function classifyRequest(
	method: string,
	pathname: string,
): "write" | "test" | "replay" | "read" {
	if (/\/test\b/.test(pathname)) return "test";
	if (/\/replay\b/.test(pathname)) return "replay";
	if (method === "GET" || method === "HEAD") return "read";
	return "write";
}

const PROVISIONING_RETRY_AFTER_SECONDS = 30;

/** Gateway entry: one request id end to end (a valid incoming
 *  `X-Request-Id` is reused, else minted), forwarded upstream and set on every
 *  response; error responses get the hosted envelope and are recorded. */
export async function handleGatewayRequest(
	deps: GatewayDeps,
	req: Request,
): Promise<Response> {
	const incoming = req.headers.get("x-request-id");
	const requestId =
		incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : newRequestId();
	const ctx: { accountId?: string } = {};
	const res = await route(deps, req, requestId, ctx);
	return finalize(deps, req, res, requestId, ctx.accountId);
}

/** Error bodies above this are passed through unrewritten. */
const MAX_REWRITE_BYTES = 65536;

async function finalize(
	deps: GatewayDeps,
	req: Request,
	res: Response,
	requestId: string,
	accountId: string | undefined,
): Promise<Response> {
	const headers = new Headers(res.headers);
	headers.set("x-request-id", requestId);
	const status = res.status;
	// Success streams untouched: its body is never read here.
	if (status < 400) return new Response(res.body, { status, headers });

	let code = DEFAULT_CODE_BY_STATUS[status] ?? "HTTP_ERROR";
	let message = "";
	let outBody: string | ReadableStream<Uint8Array> | null = res.body;
	const length = Number(headers.get("content-length") ?? Number.NaN);
	if (
		headers.get("content-type")?.includes("application/json") &&
		(Number.isNaN(length) || length <= MAX_REWRITE_BYTES)
	) {
		const text = await res.text();
		outBody = text;
		try {
			const augmented = augmentErrorBody(JSON.parse(text), {
				status,
				requestId,
				feedbackUrl: FEEDBACK_URL.platform,
				overrideFeedback: true,
			});
			if (augmented) {
				outBody = JSON.stringify(augmented);
				code = String(augmented.code);
				message = String(augmented.error ?? "").slice(0, 200);
				headers.delete("content-length");
			}
		} catch {
			// Not JSON after all: pass the text through unchanged.
		}
	}

	if (accountId && status !== 429) {
		const url = new URL(req.url);
		try {
			deps.recordFailure?.({
				request_id: requestId,
				account_id: accountId,
				method: req.method,
				path: url.pathname,
				status,
				code,
				message,
				query: redactQuery(url.searchParams),
				origin: normalizeOrigin(req.headers.get("x-sl-origin") ?? undefined),
			});
		} catch {
			// Recording never affects the response.
		}
	}
	return new Response(outBody, { status, headers });
}

async function route(
	deps: GatewayDeps,
	req: Request,
	requestId: string,
	ctx: { accountId?: string },
): Promise<Response> {
	const url = new URL(req.url);
	// Unauthenticated liveness + version probe (loopback only, like the rest).
	if (url.pathname === "/healthz") {
		return Response.json({
			status: "ok",
			sha: deps.sha ?? null,
			busy: deps.isBusy?.() ?? false,
		});
	}
	const presentedKey = bearerToken(req.headers.get("authorization"));
	if (!presentedKey) {
		return Response.json(
			{
				error: "missing_api_key",
				hint: "Send Authorization: Bearer sk-sl_...",
			},
			{ status: 401 },
		);
	}

	const introspected = await deps.introspect.resolve(presentedKey);
	if (!introspected.ok) {
		return Response.json({ error: "invalid_api_key" }, { status: 401 });
	}

	ctx.accountId = introspected.accountId;

	if (!introspected.creditsOk) {
		return Response.json(
			{
				error: "insufficient_credits",
				top_up_url: "https://www.secondlayer.tools/account/credits",
			},
			{ status: 402 },
		);
	}

	const bucket = classifyRequest(req.method, url.pathname);
	const decision = deps.rateLimit?.(introspected.accountId, bucket);
	if (decision && !decision.allowed) {
		const res = Response.json({ error: "rate_limited" }, { status: 429 });
		if (decision.retryAfterSeconds !== undefined) {
			res.headers.set("Retry-After", String(decision.retryAfterSeconds));
		}
		return res;
	}

	const state = await deps.resolveTenant(introspected.accountId);
	if (state === undefined) {
		// A read against an account with no tenant yet must not provision one —
		// opening the dashboard's webhooks or subgraphs page shouldn't start a
		// billed service. Only a write (create/update/delete/pause/deploy/...)
		// provisions.
		if (bucket === "read") {
			return emptyRead(url.pathname);
		}
		deps.startProvisioning(introspected.accountId);
		return withRetryAfter(
			Response.json(
				{
					error: "provisioning",
					retry_after: PROVISIONING_RETRY_AFTER_SECONDS,
				},
				{ status: 503 },
			),
			PROVISIONING_RETRY_AFTER_SECONDS,
		);
	}
	if (state === "provisioning") {
		return withRetryAfter(
			Response.json(
				{
					error: "provisioning",
					retry_after: PROVISIONING_RETRY_AFTER_SECONDS,
				},
				{ status: 503 },
			),
			PROVISIONING_RETRY_AFTER_SECONDS,
		);
	}
	if (state === "stopped") {
		// Review fix 3b: introspect already confirmed creditsOk (checked
		// above) — a stopped tenant whose balance is fine just hasn't been
		// restarted by the 5-minute poll yet. Kick it in the background and
		// tell the caller to retry, instead of 402'ing a topped-up account.
		deps.startTenant(introspected.accountId);
		return withRetryAfter(
			Response.json(
				{
					error: "starting",
					retry_after: PROVISIONING_RETRY_AFTER_SECONDS,
				},
				{ status: 503 },
			),
			PROVISIONING_RETRY_AFTER_SECONDS,
		);
	}
	if (state === "destroyed") {
		return Response.json({ error: "invalid_api_key" }, { status: 401 });
	}

	const upstream = await deps.tenantUpstream(introspected.accountId);
	const forwardUrl = new URL(url.pathname + url.search, upstream.baseUrl);
	const doFetch = deps.fetchImpl ?? fetch;

	const forwardHeaders = new Headers(req.headers);
	// The customer's key never reaches the stack — swap it for that stack's
	// own INSTANCE_TOKEN (Design, step 4).
	forwardHeaders.set("authorization", `Bearer ${upstream.instanceToken}`);
	forwardHeaders.delete("host");
	forwardHeaders.set("x-request-id", requestId);

	try {
		const upstreamRes = await doFetch(forwardUrl.toString(), {
			method: req.method,
			headers: forwardHeaders,
			body:
				req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
			duplex: req.body ? "half" : undefined,
		});
		return new Response(upstreamRes.body, {
			status: upstreamRes.status,
			headers: upstreamRes.headers,
		});
	} catch (err) {
		logger.error("workload.gateway.upstream_error", {
			accountId: introspected.accountId,
			requestId,
			error: err instanceof Error ? err.message : String(err),
		});
		return Response.json({ error: "upstream_unavailable" }, { status: 502 });
	}
}

const LIST_PATHS = new Set([
	"/api/webhooks",
	"/api/subgraphs",
	"/v1/subgraphs",
]);

/** What a read returns for an account with no tenant: an empty list for a
 *  collection path, otherwise a 404 worded for the resource asked about. */
function emptyRead(pathname: string): Response {
	if (LIST_PATHS.has(pathname.replace(/\/+$/, ""))) {
		return Response.json({ data: [] }, { status: 200 });
	}
	const isSubgraph =
		pathname.startsWith("/api/subgraphs") ||
		pathname.startsWith("/v1/subgraphs");
	return Response.json(
		{ error: isSubgraph ? "Subgraph not found" : "Webhook not found" },
		{ status: 404 },
	);
}

function withRetryAfter(res: Response, seconds: number): Response {
	res.headers.set("Retry-After", String(seconds));
	return res;
}
