/**
 * Instance modes for the Secondlayer platform.
 *
 * - `oss`: self-hosted, single-tenant. No auth middleware, no platform routes
 *   (projects, admin, tenants). Everything runs against a single
 *   `DATABASE_URL`. Intended for `docker compose up`.
 *
 * - `dedicated`: per-customer managed instance. JWT-based auth (anon =
 *   read-only, service = full). Dual-DB mode — shared source indexer DB for
 *   block reads, per-tenant target DB for subgraph data. No platform-wide
 *   routes mounted (no cross-tenant accounts).
 *
 * - `platform`: control-plane mode. Magic-link auth, API keys, projects,
 *   tenants, admin. Serves the dashboard + CLI against a single shared DB.
 */

export type InstanceMode = "oss" | "dedicated" | "platform";

const VALID_MODES: readonly InstanceMode[] = ["oss", "dedicated", "platform"];

/**
 * Resolve the active instance mode from `process.env.INSTANCE_MODE`.
 * Defaults to `"oss"` — the safest default for self-hosters who deploy
 * without setting the variable.
 */
export function getInstanceMode(): InstanceMode {
	const raw = process.env.INSTANCE_MODE?.trim().toLowerCase();
	if (raw && (VALID_MODES as readonly string[]).includes(raw)) {
		return raw as InstanceMode;
	}
	return "oss";
}

/** True when the active mode is `"platform"` (shared multi-tenant). */
export function isPlatformMode(): boolean {
	return getInstanceMode() === "platform";
}

/** True when the active mode is `"oss"` (self-hosted). */
export function isOssMode(): boolean {
	return getInstanceMode() === "oss";
}

/** True when the active mode is `"dedicated"` (per-tenant managed). */
export function isDedicatedMode(): boolean {
	return getInstanceMode() === "dedicated";
}
