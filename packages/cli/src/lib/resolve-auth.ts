import { readSession } from "./session.ts";

export interface ResolvedAuth {
	apiUrl: string;
	/** Bearer token — either SL_SERVICE_KEY (CI/OSS) or the session token. */
	ephemeralKey: string;
	/** `true` when coming from env-var path (CI/OSS mode). */
	fromEnv: boolean;
}

const PLATFORM_API_URL =
	process.env.SL_PLATFORM_API_URL ?? "https://api.secondlayer.tools";

export async function resolveAuth(): Promise<ResolvedAuth> {
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

/** `true` when running in OSS / CI mode (env-var-driven, no session). */
export function isOssMode(): boolean {
	return !!process.env.SL_API_URL && !process.env.SL_SERVICE_KEY;
}
