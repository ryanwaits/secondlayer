import { logger } from "@secondlayer/shared";
import type { Subgraph } from "@secondlayer/shared/db";
import postgres from "postgres";

/**
 * In-memory cache of subgraph registry, invalidated via PG NOTIFY.
 * Keyed by name: names are unique per instance.
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
	private refreshSeq = 0;
	private appliedSeq = 0;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private static readonly DEBOUNCE_MS = 500;

	constructor(private loadAll: () => Promise<Subgraph[]>) {}

	async start(): Promise<void> {
		await this.refresh();

		// Subgraph registry lives in the target DB (tenant-side). In dual-DB
		// mode, listener must bind to TARGET_DATABASE_URL — DATABASE_URL alone
		// wouldn't reach the tenant in dedicated deployments.
		// `||` so an empty-string TARGET_DATABASE_URL (passed through compose as "")
		// falls back to DATABASE_URL instead of resolving to "".
		const url = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;
		if (!url) return;

		this.listener = postgres(url, { max: 1 });
		this.listener.listen("subgraph_changes", (_payload: string) => {
			if (this.debounceTimer) clearTimeout(this.debounceTimer);
			this.debounceTimer = setTimeout(() => {
				logger.info("Subgraph registry changed, refreshing cache");
				// A failed reload keeps the last good cache; the next change
				// notification tries again.
				this.refresh().catch((error) => {
					logger.warn("Subgraph registry refresh failed; keeping cached copy", {
						error: error instanceof Error ? error.message : String(error),
					});
				});
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
		// Refreshes can overlap. A load applies only if it started after the last
		// one applied, so a slow older load never overwrites a newer snapshot.
		const seq = ++this.refreshSeq;
		const allSubgraphs = await this.loadAll();
		if (seq < this.appliedSeq) return;
		this.appliedSeq = seq;
		this.subgraphs.clear();
		for (const v of allSubgraphs) {
			this.subgraphs.set(v.name, v);
		}
		this.loaded = true;
		logger.info("Subgraph registry cache loaded", {
			count: this.subgraphs.size,
		});
	}

	get(name: string): Subgraph | undefined {
		return this.subgraphs.get(name);
	}

	getAll(): Subgraph[] {
		return Array.from(this.subgraphs.values());
	}

	get isLoaded(): boolean {
		return this.loaded;
	}
}
