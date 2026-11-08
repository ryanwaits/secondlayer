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
 *
 * A NOTIFY sent while the listener was disconnected is lost, so the cache also
 * reloads whenever the listener (re)subscribes and on a TTL: it can be stale
 * for at most `ttlMs`, whatever happened to the connection.
 */
export class SubgraphRegistryCache {
	private subgraphs = new Map<string, Subgraph>();
	private listener: ReturnType<typeof postgres> | null = null;
	private loaded = false;
	private refreshSeq = 0;
	private appliedSeq = 0;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private ttlTimer: ReturnType<typeof setInterval> | null = null;
	private static readonly DEBOUNCE_MS = 500;
	static readonly DEFAULT_TTL_MS = 60_000;

	constructor(
		private loadAll: () => Promise<Subgraph[]>,
		private ttlMs = SubgraphRegistryCache.DEFAULT_TTL_MS,
	) {}

	async start(): Promise<void> {
		await this.refresh();
		this.ttlTimer = setInterval(() => {
			void this.refreshQuietly();
		}, this.ttlMs);
		this.ttlTimer.unref?.();

		// Subgraph registry lives in the target DB (tenant-side). In dual-DB
		// mode, listener must bind to TARGET_DATABASE_URL — DATABASE_URL alone
		// wouldn't reach the tenant in dedicated deployments.
		// `||` so an empty-string TARGET_DATABASE_URL (passed through compose as "")
		// falls back to DATABASE_URL instead of resolving to "".
		const url = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;
		if (!url) return;

		this.listener = postgres(url, { max: 1 });
		let subscribedBefore = false;
		this.listener.listen(
			"subgraph_changes",
			(_payload: string) => {
				if (this.debounceTimer) clearTimeout(this.debounceTimer);
				this.debounceTimer = setTimeout(() => {
					logger.info("Subgraph registry changed, refreshing cache");
					void this.refreshQuietly();
				}, SubgraphRegistryCache.DEBOUNCE_MS);
			},
			// Runs on every (re)subscribe. The first one follows the load above;
			// later ones mean the connection dropped and NOTIFYs may be missed.
			() => {
				if (subscribedBefore) {
					logger.info("Subgraph registry listener reconnected, reloading");
					void this.refreshQuietly();
				}
				subscribedBefore = true;
			},
		);
	}

	/** Reload, keeping the last good cache when the load fails. */
	async refreshQuietly(): Promise<void> {
		try {
			await this.refresh();
		} catch (error) {
			logger.warn("Subgraph registry refresh failed; keeping cached copy", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	async stop(): Promise<void> {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		if (this.ttlTimer) clearInterval(this.ttlTimer);
		this.ttlTimer = null;
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
