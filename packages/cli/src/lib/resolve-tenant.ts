import { readSession } from "./session.ts";

/**
 * Post shared-rip (2026-05-14) subgraphs + subscriptions live on the platform
 * API alongside everything else. There is no longer a separate tenant URL or
 * an ephemeral JWT to mint — this helper exists only so legacy call sites keep
 * compiling. New code should use `httpPlatform`/`getPlatformClient` directly.
 *
 * Decision tree:
 *   1. `SL_API_URL` + `SL_SERVICE_KEY` env vars set → use directly (CI/OSS)
 *   2. Active session                              → platform url + session token
 *   3. Nothing                                     → throw SESSION_EXPIRED
 */

export interface ResolvedTenant {
	apiUrl: string;
	/** Bearer token for the API — either SL_SERVICE_KEY or the session token. */
	ephemeralKey: string;
	/** `true` if we came from the env-var path (CI/OSS). */
	fromEnv: boolean;
}

export interface ResolveOptions {
	/** Reserved for future multi-tenant flag. Currently ignored. */
	tenant?: string;
}

const PLATFORM_API_URL =
	process.env.SL_PLATFORM_API_URL ?? "https://api.secondlayer.tools";

export async function resolveActiveTenant(
	_opts: ResolveOptions = {},
): Promise<ResolvedTenant> {
	const envUrl = process.env.SL_API_URL;
	const envKey = process.env.SL_SERVICE_KEY;
	if (envUrl && envKey) {
		return { apiUrl: envUrl, ephemeralKey: envKey, fromEnv: true };
	}

	const session = await readSession();
	if (!session) {
		const err = new Error("Not logged in — run `sl login`");
		(err as unknown as { code: string }).code = "SESSION_EXPIRED";
		throw err;
	}

	return {
		apiUrl: PLATFORM_API_URL,
		ephemeralKey: session.token,
		fromEnv: false,
	};
}

/**
 * Returns `true` when running in OSS / CI mode (env-var-driven, no session).
 */
export function isOssMode(): boolean {
	return !!process.env.SL_API_URL && !process.env.SL_SERVICE_KEY;
}
