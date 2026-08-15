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

/** What the operator wrote in the env — `archive` is the honest name for the
 *  metered public-archive deployment and aliases `platform` behaviorally. */
export type DeclaredInstanceMode = InstanceMode | "archive";

const VALID_MODES: readonly DeclaredInstanceMode[] = [
	"oss",
	"platform",
	"archive",
];

function declaredMode(): DeclaredInstanceMode {
	const raw = process.env.INSTANCE_MODE?.trim().toLowerCase();
	if (raw && (VALID_MODES as readonly string[]).includes(raw)) {
		return raw as DeclaredInstanceMode;
	}
	return "oss";
}

/**
 * Resolve the active instance mode from `process.env.INSTANCE_MODE`.
 * Defaults to `"oss"` — the safest default for self-hosters who deploy
 * without setting the variable. `archive` normalizes to `platform` here so
 * every behavioral branch stays a two-way choice; use
 * `getDeclaredInstanceMode()` for display surfaces.
 */
export function getInstanceMode(): InstanceMode {
	const declared = declaredMode();
	return declared === "archive" ? "platform" : declared;
}

/** The mode as declared in the env, for status/identity surfaces. */
export function getDeclaredInstanceMode(): DeclaredInstanceMode {
	return declaredMode();
}

/**
 * True when public reads are credit-metered (the free window, retention, and
 * credits gates arm). Platform/archive deployments meter by default;
 * self-host never does unless the operator explicitly sets
 * `METERED_READS=true`. `METERED_READS=false` disarms a metered deployment.
 */
export function isMeteredReads(): boolean {
	const override = process.env.METERED_READS?.trim().toLowerCase();
	if (override === "true") return true;
	if (override === "false") return false;
	return getInstanceMode() === "platform";
}

/** True when the active mode is `"platform"` (shared multi-tenant). */
export function isPlatformMode(): boolean {
	return getInstanceMode() === "platform";
}

/** True when the active mode is `"oss"` (self-hosted). */
export function isOssMode(): boolean {
	return getInstanceMode() === "oss";
}
