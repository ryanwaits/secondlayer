import { logger } from "@secondlayer/shared";
import type { Subgraph } from "@secondlayer/shared/db";
import postgres from "postgres";

/**
 * In-memory cache of subgraph registry, invalidated via PG NOTIFY.
 * Account-aware: subgraphs keyed by (account_id, name) composite.
 */
export class SubgraphRegistryCache {
	private subgraphs = new Map<string, Subgraph>();
	private listener: ReturnType<typeof postgres> | null = null;
	private loaded = false;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private static readonly DEBOUNCE_MS = 500;

	constructor(private loadAll: () => Promise<Subgraph[]>) {}

	/** Composite cache key: "accountId:subgraphName" or ":subgraphName" for empty account */
	private cacheKey(name: string, accountId?: string | null): string {
		return `${accountId ?? ""}:${name}`;
	}

	async start(): Promise<void> {
		await this.refresh();

		const url = process.env.DATABASE_URL;
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
		if (!accountId) return all;
		return all.filter((v) => !v.account_id || v.account_id === accountId);
	}

	/** Get all public subgraphs (for marketplace browsing) */
	getPublic(): Subgraph[] {
		return Array.from(this.subgraphs.values()).filter((v) => v.is_public);
	}

	/** Get a single public subgraph by name (no ownership check) */
	getPublicByName(name: string): Subgraph | undefined {
		for (const v of this.subgraphs.values()) {
			if (v.name === name && v.is_public) return v;
		}
		return undefined;
	}

	get isLoaded(): boolean {
		return this.loaded;
	}
}
