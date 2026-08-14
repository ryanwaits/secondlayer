import { readSession } from "./session.ts";

export interface ResolvedAuth {
	apiUrl: string;
	/** Bearer token — an env API key (CI/OSS) or the session token. */
	ephemeralKey: string;
	/** `true` when the credential came from an env var rather than the session. */
	fromEnv: boolean;
}

export const LOCAL_API_URL = "http://127.0.0.1:3800";
export const ARCHIVE_OPS_API_URL = "https://api.secondlayer.tools";

/**
 * Resolve the API endpoint. Independent of the credential: setting only
 * SL_API_URL redirects the endpoint while keeping the session token.
 * Default is the local one-box API.
 */
export function resolveApiUrl(): string {
	return (
		process.env.SL_API_URL ??
		process.env.SL_PLATFORM_API_URL ??
		LOCAL_API_URL
	).replace(/\/+$/, "");
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

	if (isOssMode()) {
		return { apiUrl, ephemeralKey: "", fromEnv: true };
	}

	const session = await readSession();
	if (!session) {
		const err = new Error("Not logged in — run `secondlayer login`");
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
	try {
		return new URL(resolveApiUrl()).hostname !== "api.secondlayer.tools";
	} catch {
		return true;
	}
}
