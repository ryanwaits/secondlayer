/**
 * Gateway-side client for app-server's `POST /internal/keys/introspect`
 * (step 2). Caches positive results 60s and negative results 10s (Design) —
 * a revoked key stops reading within 60s and stops writing within 5s, and a
 * brute-forced garbage key doesn't get a fresh round trip to app-server on
 * every retry.
 */

import type { FetchLike } from "./fetch-like.ts";

export type IntrospectResult =
	| {
			ok: true;
			accountId: string;
			creditsOk: boolean;
			/** The account key that was presented; null for a dashboard session
			 *  (or an api that predates the field, so reads stay free during a
			 *  rolling deploy). */
			apiKeyId: string | null;
	  }
	| { ok: false; docsKey?: true };

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
	/** How old a cached result may be and still serve a write. Default 5_000. */
	writeTtlMs?: number;
	/** Cache size bound; the oldest entry is evicted past it. Default 10_000. */
	maxEntries?: number;
}

interface CacheEntry {
	result: IntrospectResult;
	cachedAt: number;
	expiresAt: number;
}

const DEFAULT_POSITIVE_TTL_MS = 60_000;
const DEFAULT_WRITE_TTL_MS = 5_000;
const DEFAULT_NEGATIVE_TTL_MS = 10_000;
const DEFAULT_MAX_ENTRIES = 10_000;

export class IntrospectClient {
	private readonly cache = new Map<string, CacheEntry>();
	private readonly inflight = new Map<string, Promise<IntrospectResult>>();

	constructor(private readonly cfg: IntrospectClientConfig) {}

	get size(): number {
		return this.cache.size;
	}

	/** Drop every cached entry. Test-only / operator-triggered flush. */
	clearCache(): void {
		this.cache.clear();
	}

	/** `write` requests (anything that changes state) accept a cached result only
	 *  if it is under `writeTtlMs` old, so a revoked key or a stopped account is
	 *  refused on a write within seconds; reads keep the full TTL. */
	async resolve(
		presentedKey: string,
		opts: { write?: boolean } = {},
	): Promise<IntrospectResult> {
		const now = this.cfg.now?.() ?? Date.now();
		const cached = this.cache.get(presentedKey);
		const writeTtl = this.cfg.writeTtlMs ?? DEFAULT_WRITE_TTL_MS;
		if (
			cached &&
			cached.expiresAt > now &&
			(!opts.write || now - cached.cachedAt < writeTtl)
		) {
			return cached.result;
		}
		if (cached && cached.expiresAt <= now) this.cache.delete(presentedKey);

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
		this.makeRoom(now);
		this.cache.set(presentedKey, {
			result,
			cachedAt: now,
			expiresAt: now + ttl,
		});
		return result;
	}

	/** Keep the map bounded: at capacity drop expired entries, then the oldest
	 *  insertion (Map iterates in insertion order). */
	private makeRoom(now: number): void {
		const max = this.cfg.maxEntries ?? DEFAULT_MAX_ENTRIES;
		if (this.cache.size < max) return;
		for (const [key, entry] of this.cache) {
			if (entry.expiresAt <= now) this.cache.delete(key);
		}
		while (this.cache.size >= max) {
			const oldest = this.cache.keys().next();
			if (oldest.done) break;
			this.cache.delete(oldest.value);
		}
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
		if (res.status === 403) {
			const refused = (await res.json().catch(() => null)) as {
				error?: string;
			} | null;
			return refused?.error === "docs_key"
				? { ok: false, docsKey: true }
				: { ok: false };
		}
		if (!res.ok) return { ok: false };
		const body = (await res.json().catch(() => null)) as {
			account_id?: string;
			credits_ok?: boolean;
			api_key_id?: string | null;
		} | null;
		if (!body?.account_id || typeof body.credits_ok !== "boolean") {
			return { ok: false };
		}
		return {
			ok: true,
			accountId: body.account_id,
			creditsOk: body.credits_ok,
			apiKeyId: typeof body.api_key_id === "string" ? body.api_key_id : null,
		};
	}
}
