import { resolveApiKey } from "@secondlayer/sdk";
import { resolveApiUrl } from "./api-url.ts";
import { readSession } from "./session.ts";

export {
	ARCHIVE_OPS_API_URL,
	LOCAL_API_URL,
	resolveApiUrl,
	resolveArchiveOpsUrl,
} from "./api-url.ts";

export interface ResolvedAuth {
	apiUrl: string;
	/** Bearer token — an env API key (CI/OSS) or the session token. */
	ephemeralKey: string;
	/** `true` when the credential came from an env var rather than the session. */
	fromEnv: boolean;
}

/**
 * Resolve an env-provided *instance* credential. Precedence, highest first:
 *
 *   1. the global `--api-key` flag when it is hex, which `cli.ts` funnels into
 *      `INSTANCE_TOKEN` so it beats whatever is already exported;
 *   2. `INSTANCE_TOKEN` — the canonical instance credential, written by
 *      `secondlayer init` and validated by the instance API.
 *
 * Does not read `SL_API_KEY` / `SECONDLAYER_API_KEY` (those are the hosted
 * account key). Empty values count as unset. Delegated to the SDK's
 * `resolveApiKey` so the CLI, SDK, and MCP server can never disagree.
 */
export function resolveEnvKey(): string | undefined {
	return resolveApiKey();
}

/**
 * Shape-route a `--api-key` flag value into the correct env var(s). Hex →
 * `INSTANCE_TOKEN`; `sk-sl_*` / `ss-sl_*` → `SECONDLAYER_API_KEY` (+ one-release
 * `SL_API_KEY` alias). Exported for tests; `cli.ts` preAction calls the same
 * rules inline.
 */
export function applyApiKeyFlag(apiKey: string): void {
	if (/^s[ks]-sl_/.test(apiKey)) {
		process.env.SECONDLAYER_API_KEY = apiKey;
		process.env.SL_API_KEY = apiKey;
	} else {
		process.env.INSTANCE_TOKEN = apiKey;
	}
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
