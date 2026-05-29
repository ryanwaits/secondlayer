import type { StreamsEventEnvelope } from "./events.ts";
import type { StreamsReorg } from "./reorgs.ts";

/**
 * In-process cache for finalized Streams event pages.
 *
 * Finalized pages (resolved range past the finality boundary) are immutable, so
 * their event payload can be memoized indefinitely and served without touching
 * Postgres. Only the immutable slice is cached — `tip` is attached fresh on each
 * serve, and per-tenant rate-limit headers are still set by middleware per
 * request, so nothing tenant-specific is shared.
 *
 * Bounded LRU (insertion-order Map): on hit we refresh recency; on overflow we
 * evict the oldest entry.
 */
export type CachedStreamsPage = {
	events: StreamsEventEnvelope[];
	next_cursor: string | null;
	reorgs: StreamsReorg[];
};

const DEFAULT_MAX_ENTRIES = 2000;

export class StreamsResponseCache {
	private readonly store = new Map<string, CachedStreamsPage>();

	constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

	get(key: string): CachedStreamsPage | undefined {
		const hit = this.store.get(key);
		if (hit === undefined) return undefined;
		// Refresh recency.
		this.store.delete(key);
		this.store.set(key, hit);
		return hit;
	}

	set(key: string, value: CachedStreamsPage): void {
		if (this.store.has(key)) this.store.delete(key);
		this.store.set(key, value);
		while (this.store.size > this.maxEntries) {
			const oldest = this.store.keys().next().value;
			if (oldest === undefined) break;
			this.store.delete(oldest);
		}
	}

	get size(): number {
		return this.store.size;
	}

	clear(): void {
		this.store.clear();
	}
}

/** Shared cache for the live API process. */
export const streamsResponseCache = new StreamsResponseCache();
