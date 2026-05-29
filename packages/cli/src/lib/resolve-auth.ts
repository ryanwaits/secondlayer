import { readSession } from "./session.ts";

export interface ResolvedAuth {
	apiUrl: string;
	/** Bearer token — an env API key (CI/OSS) or the session token. */
	ephemeralKey: string;
	/** `true` when the credential came from an env var rather than the session. */
	fromEnv: boolean;
}

const DEFAULT_API_URL = "https://api.secondlayer.tools";

/**
 * Resolve the API endpoint. Independent of the credential: setting only
 * SL_API_URL redirects the endpoint while keeping the session token, so
 * `SL_API_URL=http://localhost… sl …` hits local instead of silently prod.
 */
export function resolveApiUrl(): string {
	return (
		process.env.SL_API_URL ?? process.env.SL_PLATFORM_API_URL ?? DEFAULT_API_URL
	);
}

/**
 * Resolve an env-provided credential. `SL_API_KEY` is the only accepted var.
 */
export function resolveEnvKey(): string | undefined {
	return process.env.SL_API_KEY;
}

export async function resolveAuth(): Promise<ResolvedAuth> {
	const apiUrl = resolveApiUrl();

	const envKey = resolveEnvKey();
	if (envKey) {
		return { apiUrl, ephemeralKey: envKey, fromEnv: true };
	}

	const session = await readSession();
	if (!session) {
		const err = new Error("Not logged in — run `sl login`");
		(err as unknown as { code: string }).code = "SESSION_EXPIRED";
		throw err;
	}

	return { apiUrl, ephemeralKey: session.token, fromEnv: false };
}

/**
 * `true` when the CLI is pointed at a custom endpoint via env (OSS / CI /
 * local devnet). Derived from the same SL_API_URL that `resolveAuth` honors,
 * so the two never disagree.
 */
export function isOssMode(): boolean {
	return !!process.env.SL_API_URL;
}
