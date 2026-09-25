/**
 * Gateway-side client for app-server's `POST /internal/keys/introspect`
 * (step 2). Caches positive results 60s and negative results 10s (Design) —
 * a revoked key stops working within 60s, and a brute-forced garbage key
 * doesn't get a fresh round trip to app-server on every retry.
 */

import type { FetchLike } from "./fetch-like.ts";

export type IntrospectResult =
	| { ok: true; accountId: string; creditsOk: boolean }
	| { ok: false };

export interface IntrospectClientConfig {
	/** app-server's base URL, e.g. https://api.secondlayer.tools */
	appServerUrl: string;
	/** `WORKLOAD_HOST_KEY` — the same first-party key `/internal/meters` and
	 *  `/internal/keys/introspect` both guard with. */
	workloadHostKey: string;
	fetchImpl?: FetchLike;
	now?: () => number;
	positiveTtlMs?: number;
	negativeTtlMs?: number;
}

interface CacheEntry {
	result: IntrospectResult;
	expiresAt: number;
}

const DEFAULT_POSITIVE_TTL_MS = 60_000;
const DEFAULT_NEGATIVE_TTL_MS = 10_000;

export class IntrospectClient {
	private readonly cache = new Map<string, CacheEntry>();
	private readonly inflight = new Map<string, Promise<IntrospectResult>>();

	constructor(private readonly cfg: IntrospectClientConfig) {}

	/** Drop every cached entry. Test-only / operator-triggered flush. */
	clearCache(): void {
		this.cache.clear();
	}

	async resolve(presentedKey: string): Promise<IntrospectResult> {
		const now = this.cfg.now?.() ?? Date.now();
		const cached = this.cache.get(presentedKey);
		if (cached && cached.expiresAt > now) return cached.result;

		// Coalesce concurrent lookups for the same key into one upstream call —
		// a burst of requests on a cold cache must not fan out N introspect
		// calls to app-server.
		const existing = this.inflight.get(presentedKey);
		if (existing) return existing;

		const promise = this.fetchAndCache(presentedKey, now);
		this.inflight.set(presentedKey, promise);
		try {
			return await promise;
		} finally {
			this.inflight.delete(presentedKey);
		}
	}

	private async fetchAndCache(
		presentedKey: string,
		now: number,
	): Promise<IntrospectResult> {
		const result = await this.fetchUpstream(presentedKey);
		const ttl = result.ok
			? (this.cfg.positiveTtlMs ?? DEFAULT_POSITIVE_TTL_MS)
			: (this.cfg.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS);
		this.cache.set(presentedKey, { result, expiresAt: now + ttl });
		return result;
	}

	private async fetchUpstream(presentedKey: string): Promise<IntrospectResult> {
		const doFetch = this.cfg.fetchImpl ?? fetch;
		let res: Response;
		try {
			res = await doFetch(
				`${this.cfg.appServerUrl.replace(/\/+$/, "")}/internal/keys/introspect`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${this.cfg.workloadHostKey}`,
					},
					body: JSON.stringify({ key: presentedKey }),
				},
			);
		} catch {
			// Network failure to app-server: fail closed, same as a 401 — never
			// let an upstream outage look like an authenticated request.
			return { ok: false };
		}
		if (!res.ok) return { ok: false };
		const body = (await res.json().catch(() => null)) as {
			account_id?: string;
			credits_ok?: boolean;
		} | null;
		if (!body?.account_id || typeof body.credits_ok !== "boolean") {
			return { ok: false };
		}
		return { ok: true, accountId: body.account_id, creditsOk: body.credits_ok };
	}
}
