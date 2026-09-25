/**
 * The workload host's gateway (Design, step 4): the ONLY thing that ever
 * sees a customer's `sk-sl_*` key. Introspect → resolve the account's
 * tenant stack (provisioning it on the first request) → forward with the
 * stack's own `INSTANCE_TOKEN` swapped in. The customer key never reaches a
 * tenant stack.
 *
 * Phase 1 (D5): routes `/api/webhooks*` only. 046 adds `/api/subgraphs*` and
 * `/v1/subgraphs*` — same request handling, this module doesn't change.
 */

import { logger } from "@secondlayer/shared";
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
	 *  Retry-After and the tenant is `running` by the time they retry. */
	startProvisioning: (accountId: string, accountKey: string) => void;
	/** `http://tenant-<acct8>-api:3800`-shaped base URL for a running
	 *  tenant's `api` service, and its `INSTANCE_TOKEN` to swap in. */
	tenantUpstream: (
		accountId: string,
	) => Promise<{ baseUrl: string; instanceToken: string }>;
	fetchImpl?: FetchLike;
	rateLimit?: RateLimiter;
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

/** Coarse rate-limit bucket for a webhooks request, matching the Design's
 *  step 4 numbers (create/update/delete 30/min, test 10/min, replay
 *  5/hour, reads 600/min). The gateway only classifies; the actual limiter
 *  is injected so 046 can reuse this classifier for `/api/subgraphs*` too. */
export function classifyWebhooksRequest(
	method: string,
	pathname: string,
): "write" | "test" | "replay" | "read" {
	if (/\/test\b/.test(pathname)) return "test";
	if (/\/replay\b/.test(pathname)) return "replay";
	if (method === "GET" || method === "HEAD") return "read";
	return "write";
}

const PROVISIONING_RETRY_AFTER_SECONDS = 30;

export async function handleGatewayRequest(
	deps: GatewayDeps,
	req: Request,
): Promise<Response> {
	const url = new URL(req.url);
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

	if (!introspected.creditsOk) {
		return Response.json(
			{
				error: "insufficient_credits",
				top_up_url: "https://secondlayer.tools/billing",
			},
			{ status: 402 },
		);
	}

	const bucket = classifyWebhooksRequest(req.method, url.pathname);
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
		deps.startProvisioning(introspected.accountId, presentedKey);
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
		return Response.json(
			{
				error: "insufficient_credits",
				top_up_url: "https://secondlayer.tools/billing",
			},
			{ status: 402 },
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
			error: err instanceof Error ? err.message : String(err),
		});
		return Response.json({ error: "upstream_unavailable" }, { status: 502 });
	}
}

function withRetryAfter(res: Response, seconds: number): Response {
	res.headers.set("Retry-After", String(seconds));
	return res;
}
