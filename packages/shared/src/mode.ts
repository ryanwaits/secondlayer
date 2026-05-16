/**
 * Instance modes for the Secondlayer platform.
 *
 * - `oss`: self-hosted, single-tenant. No auth middleware, no platform routes
 *   (projects, admin). Everything runs against a single `DATABASE_URL`.
 *   Intended for `docker compose up`.
 *
 * - `platform`: control-plane mode. Magic-link auth, API keys, projects,
 *   admin. Serves the dashboard + CLI against a single shared DB. Post
 *   2026-05-14 shared-rip this also serves subgraphs + subscriptions.
 */

export type InstanceMode = "oss" | "platform";

const VALID_MODES: readonly InstanceMode[] = ["oss", "platform"];

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
