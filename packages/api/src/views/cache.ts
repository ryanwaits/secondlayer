import postgres from "postgres";
import { logger } from "@secondlayer/shared";
import type { View } from "@secondlayer/shared/db";

/**
 * In-memory cache of view registry, invalidated via PG NOTIFY.
 * Tenant-aware: views keyed by (api_key_id, name) composite.
 */
export class ViewRegistryCache {
  private views = new Map<string, View>();
  private listener: ReturnType<typeof postgres> | null = null;
  private loaded = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEBOUNCE_MS = 500;

  constructor(private loadAll: () => Promise<View[]>) {}

  /** Composite cache key: "apiKeyId:viewName" or ":viewName" for null keys */
  private cacheKey(name: string, apiKeyId?: string | null): string {
    return `${apiKeyId ?? ""}:${name}`;
  }

  async start(): Promise<void> {
    await this.refresh();

    const url = process.env.DATABASE_URL;
    if (!url) return;

    this.listener = postgres(url, { max: 1 });
    this.listener.listen("view_changes", (_payload: string) => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        logger.info("View registry changed, refreshing cache");
        this.refresh();
      }, ViewRegistryCache.DEBOUNCE_MS);
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
    const allViews = await this.loadAll();
    this.views.clear();
    for (const v of allViews) {
      this.views.set(this.cacheKey(v.name, v.api_key_id), v);
    }
    this.loaded = true;
    logger.info("View registry cache loaded", { count: this.views.size });
  }

  /** Get a view by name, optionally scoped to an API key or set of account keys */
  get(name: string, keyIds?: string[]): View | undefined {
    if (keyIds && keyIds.length > 0) {
      // Try each account key
      for (const kid of keyIds) {
        const v = this.views.get(this.cacheKey(name, kid));
        if (v) return v;
      }
      // Also check views with null api_key_id
      return this.views.get(this.cacheKey(name));
    }
    // No keyIds (DEV_MODE) — find first view with this name
    for (const v of this.views.values()) {
      if (v.name === name) return v;
    }
    return undefined;
  }

  /** Get all views, optionally filtered by account key IDs */
  getAll(keyIds?: string[]): View[] {
    const all = Array.from(this.views.values());
    if (!keyIds || keyIds.length === 0) return all;
    const keySet = new Set(keyIds);
    return all.filter((v) => !v.api_key_id || keySet.has(v.api_key_id));
  }

  get isLoaded(): boolean {
    return this.loaded;
  }
}
