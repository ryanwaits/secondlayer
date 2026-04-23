import type { MiddlewareHandler } from "hono";

/**
 * Per-tenant activity heartbeat. Bumped on every successful tenant-API
 * request; read by the worker's tenant-health cron (every ~2 min) to
 * propagate into the control-plane's `tenants.last_active_at`.
 *
 * In-memory is fine because:
 *   - The tenant API container is long-lived; if it restarts we lose
 *     seconds of heartbeat, not hours
 *   - The worker cron polls every 2 min anyway
 *   - DB writes per request would be wasteful (a chat app or a dashboard
 *     could easily hit 10/s → we'd pound the control-plane DB for no
 *     meaningful precision gain)
 *
 * Module-local state isolated to this container (no cross-tenant risk —
 * every tenant runs its own `sl-api-<slug>` process).
 */
let lastRequestAtMs = 0;

export function getLastRequestAtMs(): number {
	return lastRequestAtMs;
}

export function trackTenantActivity(): MiddlewareHandler {
	return async (c, next) => {
		await next();
		// Only count "real" traffic, not health probes or our own internal
		// activity endpoint. Otherwise every 2-min cron tick looks like
		// user traffic and nothing ever pauses.
		const path = c.req.path;
		if (path === "/health" || path.startsWith("/internal/")) return;
		if (c.res.status >= 200 && c.res.status < 400) {
			lastRequestAtMs = Date.now();
		}
	};
}
