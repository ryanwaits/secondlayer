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
 * Resolve an env-provided credential. Precedence, highest first:
 *
 *   1. the global `--api-key` flag, which `cli.ts` funnels into both env vars
 *      below so it beats whatever is already exported;
 *   2. `INSTANCE_TOKEN` — the canonical credential var, written by
 *      `secondlayer init` and validated by the instance API;
 *   3. `SL_API_KEY` — legacy alias for the same value.
 *
 * Empty values count as unset. Delegated to the SDK's `resolveApiKey` so the
 * CLI, SDK, and MCP server can never disagree about which var wins; that helper
 * also warns when the two env vars hold different values.
 */
export function resolveEnvKey(): string | undefined {
	return resolveApiKey();
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
