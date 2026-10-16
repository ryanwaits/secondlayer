/**
 * Short-lived cache for the gateway's per-request tenant lookup. The row
 * (state, stop_reason, api_port) is reloaded after a few seconds; the
 * `INSTANCE_TOKEN` is written once at provisioning, so it is held until the
 * tenant changes. The provisioner calls `invalidate` after every write it
 * makes to a tenant row, so within this process nothing routes on stale state.
 */

import type { TenantRow } from "./control-db.ts";

export interface TenantCacheConfig {
	load: (accountId: string) => Promise<TenantRow | undefined>;
	/** Reads the tenant's `INSTANCE_TOKEN`; throws when it is missing. */
	readToken: (accountId: string) => string;
	ttlMs?: number;
	now?: () => number;
}

interface RowEntry {
	row: TenantRow | undefined;
	expiresAt: number;
}

const DEFAULT_TTL_MS = 5_000;
/** A missing tenant is re-checked quickly so a first write provisions promptly. */
const MISSING_TTL_MS = 1_000;

export class TenantCache {
	private readonly rows = new Map<string, RowEntry>();
	private readonly inflight = new Map<string, Promise<TenantRow | undefined>>();
	private readonly tokens = new Map<string, string>();
	/** Bumped by `invalidate` so a load that started before it can't cache. */
	private readonly generations = new Map<string, number>();

	constructor(private readonly cfg: TenantCacheConfig) {}

	async row(accountId: string): Promise<TenantRow | undefined> {
		const now = this.cfg.now?.() ?? Date.now();
		const cached = this.rows.get(accountId);
		if (cached && cached.expiresAt > now) return cached.row;

		const existing = this.inflight.get(accountId);
		if (existing) return existing;

		const generation = this.generations.get(accountId) ?? 0;
		const promise = this.cfg
			.load(accountId)
			.then((row) => {
				if ((this.generations.get(accountId) ?? 0) === generation) {
					const ttl = row ? (this.cfg.ttlMs ?? DEFAULT_TTL_MS) : MISSING_TTL_MS;
					this.rows.set(accountId, { row, expiresAt: now + ttl });
				}
				return row;
			})
			.finally(() => {
				if (this.inflight.get(accountId) === promise) {
					this.inflight.delete(accountId);
				}
			});
		this.inflight.set(accountId, promise);
		return promise;
	}

	token(accountId: string): string {
		const cached = this.tokens.get(accountId);
		if (cached !== undefined) return cached;
		const token = this.cfg.readToken(accountId);
		this.tokens.set(accountId, token);
		return token;
	}

	invalidate(accountId: string): void {
		this.generations.set(accountId, (this.generations.get(accountId) ?? 0) + 1);
		this.rows.delete(accountId);
		this.inflight.delete(accountId);
		this.tokens.delete(accountId);
	}
}
