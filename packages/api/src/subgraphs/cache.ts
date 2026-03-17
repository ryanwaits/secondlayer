import postgres from "postgres";
import { logger } from "@secondlayer/shared";
import type { Subgraph } from "@secondlayer/shared/db";

/**
 * In-memory cache of subgraph registry, invalidated via PG NOTIFY.
 * Tenant-aware: subgraphs keyed by (api_key_id, name) composite.
 */
export class SubgraphRegistryCache {
  private subgraphs = new Map<string, Subgraph>();
  private listener: ReturnType<typeof postgres> | null = null;
  private loaded = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEBOUNCE_MS = 500;

  constructor(private loadAll: () => Promise<Subgraph[]>) {}

  /** Composite cache key: "apiKeyId:subgraphName" or ":subgraphName" for null keys */
  private cacheKey(name: string, apiKeyId?: string | null): string {
    return `${apiKeyId ?? ""}:${name}`;
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
      this.subgraphs.set(this.cacheKey(v.name, v.api_key_id), v);
    }
    this.loaded = true;
    logger.info("Subgraph registry cache loaded", { count: this.subgraphs.size });
  }

  /** Get a subgraph by name, optionally scoped to an API key or set of account keys */
  get(name: string, keyIds?: string[]): Subgraph | undefined {
    if (keyIds && keyIds.length > 0) {
      // Try each account key
      for (const kid of keyIds) {
        const v = this.subgraphs.get(this.cacheKey(name, kid));
        if (v) return v;
      }
      // Also check subgraphs with null api_key_id
      return this.subgraphs.get(this.cacheKey(name));
    }
    // No keyIds (DEV_MODE) — find first subgraph with this name
    for (const v of this.subgraphs.values()) {
      if (v.name === name) return v;
    }
    return undefined;
  }

  /** Get all subgraphs, optionally filtered by account key IDs */
  getAll(keyIds?: string[]): Subgraph[] {
    const all = Array.from(this.subgraphs.values());
    if (!keyIds || keyIds.length === 0) return all;
    const keySet = new Set(keyIds);
    return all.filter((v) => !v.api_key_id || keySet.has(v.api_key_id));
  }

  get isLoaded(): boolean {
    return this.loaded;
  }
}
