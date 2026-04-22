import { loadConfig } from "./config.ts";
import { CliHttpError, httpPlatform } from "./http.ts";
import { readActiveProject } from "./project-file.ts";

/**
 * Resolve which tenant to hit for a command invocation.
 *
 * Decision tree:
 *   1. `SL_API_URL` + `SL_SERVICE_KEY` env vars set  → use directly (CI/OSS path)
 *   2. `SL_API_URL` alone                            → OSS mode, no tenant CRUD
 *   3. Session + project                             → mint ephemeral via platform API
 *   4. No session                                    → throw SESSION_EXPIRED
 */

export interface ResolvedTenant {
	apiUrl: string;
	/** Bearer token for the tenant API — either SL_SERVICE_KEY or an ephemeral JWT. */
	ephemeralKey: string;
	/** `true` if we came from the env-var path (CI/OSS). */
	fromEnv: boolean;
}

export interface ResolveOptions {
	/** --tenant <slug> flag override (for multi-tenant future). */
	tenant?: string;
}

/**
 * Mint + return an ephemeral service JWT for the caller's active tenant.
 * Used by every tenant-scoped command (subgraphs, workflows, secrets, db).
 */
export async function resolveActiveTenant(
	opts: ResolveOptions = {},
): Promise<ResolvedTenant> {
	// 1/2. Env-var bypass (CI + OSS)
	const envUrl = process.env.SL_API_URL;
	const envKey = process.env.SL_SERVICE_KEY;
	if (envUrl && envKey) {
		return { apiUrl: envUrl, ephemeralKey: envKey, fromEnv: true };
	}

	// 3. Session-based path: mint ephemeral via platform API
	//    The platform endpoint resolves the tenant via account scope — no slug needed.
	//    The `opts.tenant` flag is reserved for future N:1 mode and ignored for now.
	void opts.tenant;

	try {
		const res = await httpPlatform<{
			apiUrl: string;
			serviceKey: string;
			expiresAt: string;
		}>("/api/tenants/me/keys/mint-ephemeral", { method: "POST" });
		return {
			apiUrl: res.apiUrl,
			ephemeralKey: res.serviceKey,
			fromEnv: false,
		};
	} catch (err) {
		if (err instanceof CliHttpError) {
			// No tenant yet for this account.
			if (err.status === 404) {
				const config = await loadConfig();
				const active = await readActiveProject(
					process.cwd(),
					config.defaultProject,
				);
				const hint = active
					? `Run 'sl instance create --plan launch' to provision for project ${active.slug}`
					: "Run 'sl project create <name>' then 'sl instance create --plan launch'";
				throw new CliHttpError(
					404,
					"NO_TENANT_FOR_PROJECT",
					{ error: hint },
					hint,
				);
			}
		}
		throw err;
	}
}

/**
 * Lightweight helper — only called by commands that need to know whether
 * we're in OSS mode (`sl instance *` rejects in OSS).
 */
export function isOssMode(): boolean {
	return !!process.env.SL_API_URL && !process.env.SL_SERVICE_KEY;
}
