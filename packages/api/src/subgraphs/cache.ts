import { logger } from "@secondlayer/shared";
import type { Subgraph } from "@secondlayer/shared/db";
import { isPlatformMode } from "@secondlayer/shared/mode";
import postgres from "postgres";

/**
 * In-memory cache of subgraph registry, invalidated via PG NOTIFY.
 *
 * Account-aware in platform mode — subgraphs keyed by (account_id, name).
 * In oss/dedicated modes, keyed by name alone (single-tenant context).
 *
 * The `subgraph_changes` NOTIFY is fired when the `subgraphs` table changes
 * (see migrations — trigger attached to the subgraphs table on target DB).
 * Listener binds to `TARGET_DATABASE_URL` when set (dual-DB mode), falling
 * back to `DATABASE_URL` otherwise.
 */
export class SubgraphRegistryCache {
	private subgraphs = new Map<string, Subgraph>();
	private listener: ReturnType<typeof postgres> | null = null;
	private loaded = false;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private static readonly DEBOUNCE_MS = 500;

	constructor(private loadAll: () => Promise<Subgraph[]>) {}

	/**
	 * Composite cache key. Platform mode includes accountId to disambiguate
	 * cross-tenant name collisions; oss/dedicated skip the prefix since there
	 * is only one tenant.
	 */
	private cacheKey(name: string, accountId?: string | null): string {
		if (!isPlatformMode()) return name;
		return `${accountId ?? ""}:${name}`;
	}

	async start(): Promise<void> {
		await this.refresh();

		// Subgraph registry lives in the target DB (tenant-side). In dual-DB
		// mode, listener must bind to TARGET_DATABASE_URL — DATABASE_URL alone
		// wouldn't reach the tenant in dedicated deployments.
		const url = process.env.TARGET_DATABASE_URL ?? process.env.DATABASE_URL;
		if (!url) return;

		this.listener = postgres(url, { max: 1 });
		this.listener.listen("subgraph_changes", (_payload: string) => {
			if (this.debounceTimer) clearTimeout(this.debounceTimer);
			this.debounceTimer = setTimeout(() => {
				logger.info("Subgraph registry changed, refreshing cache");
				this.refresh();
			}, SubgraphRegistryCache.DEBOUNCE_MS);
		});
	}

	async stop(): Promise<void> {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		if (this.listener) {
			await this.listener.end();
			this.listener = null;
		}
	}

	async refresh(): Promise<void> {
		const allSubgraphs = await this.loadAll();
		this.subgraphs.clear();
		for (const v of allSubgraphs) {
			this.subgraphs.set(this.cacheKey(v.name, v.account_id), v);
		}
		this.loaded = true;
		logger.info("Subgraph registry cache loaded", {
			count: this.subgraphs.size,
		});
	}

	/** Get a subgraph by name, optionally scoped to an account */
	get(name: string, accountId?: string): Subgraph | undefined {
		// oss/dedicated mode — name alone is unique.
		if (!isPlatformMode()) return this.subgraphs.get(name);

		if (accountId) {
			return (
				this.subgraphs.get(this.cacheKey(name, accountId)) ??
				this.subgraphs.get(this.cacheKey(name))
			);
		}
		// No accountId (DEV_MODE) — find first subgraph with this name
		for (const v of this.subgraphs.values()) {
			if (v.name === name) return v;
		}
		return undefined;
	}

	/** Get all subgraphs, optionally filtered by account */
	getAll(accountId?: string): Subgraph[] {
		const all = Array.from(this.subgraphs.values());
		if (!isPlatformMode()) return all;
		if (!accountId) return all;
		return all.filter((v) => !v.account_id || v.account_id === accountId);
	}

	get isLoaded(): boolean {
		return this.loaded;
	}
}
