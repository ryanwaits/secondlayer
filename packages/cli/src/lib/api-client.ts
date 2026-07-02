import { ApiError, SecondLayer } from "@secondlayer/sdk";
import type { PrintSchemaResponse } from "@secondlayer/sdk";
import type {
	ReindexResponse,
	SubgraphDetail,
	SubgraphGapsResponse,
	SubgraphQueryParams,
	SubgraphSummary,
} from "@secondlayer/shared/schemas";
import type {
	DeploySubgraphRequest,
	DeploySubgraphResponse,
} from "@secondlayer/shared/schemas/subgraphs";
import type {
	SubgraphAgentSchema,
	SubgraphSpecOptions,
} from "@secondlayer/shared/subgraphs/spec";
import { CliHttpError, httpPlatform } from "./http.ts";
import { printError } from "./output.ts";
import { resolveApiUrl, resolveAuth } from "./resolve-auth.ts";

export { ApiError };
export type { SubgraphQueryParams } from "@secondlayer/shared/schemas";

/** Map an HTTP status to an actionable next-step hint, when one is obvious. */
function nextStepHint(status: number | undefined): string | undefined {
	if (status === undefined) return undefined;
	if (status === 403)
		return "You may not have access — check your active project with `sl whoami`.";
	if (status === 404)
		return "Check the name/slug — run the matching `list` command to see what exists.";
	if (status === 400 || status === 422)
		return "Check the command arguments and flags — see `--help` for the expected format.";
	if (status === 429) return "Rate limited — wait a moment and retry.";
	if (status >= 500)
		return "Server error — retry shortly, or check `sl status`.";
	return undefined;
}

/**
 * Shared error handler. Maps typed codes to user-facing, actionable hints.
 */
export function handleApiError(err: unknown, action: string): never {
	const status =
		err instanceof ApiError || err instanceof CliHttpError
			? err.status
			: undefined;

	if (
		(err instanceof CliHttpError && err.code === "SESSION_EXPIRED") ||
		status === 401
	) {
		printError("Authentication required.", {
			hint: "Run `sl login` to re-authenticate.",
		});
		process.exit(1);
	}

	const detail = err instanceof Error ? err.message : String(err);
	printError(`Failed to ${action}: ${detail}`, { hint: nextStepHint(status) });
	process.exit(1);
}

/**
 * Wrap async command handlers with standardized error handling.
 */
export function withErrorHandling<TArgs extends unknown[]>(
	fn: (...args: TArgs) => Promise<void>,
	options?: {
		action?: string;
		onError?: (err: unknown) => void;
	},
): (...args: TArgs) => Promise<void> {
	return async (...args: TArgs) => {
		try {
			await fn(...args);
		} catch (err) {
			if (options?.onError) {
				options.onError(err);
			} else {
				handleApiError(err, options?.action ?? "execute command");
			}
		}
	};
}

export async function assertOk(res: Response): Promise<void> {
	if (res.ok) return;
	const body = await res.text();
	try {
		const parsed = JSON.parse(body);
		if (typeof parsed.error === "string" && parsed.error)
			throw new Error(parsed.error);
	} catch (e) {
		if (e instanceof Error && e.message !== body) throw e;
	}
	throw new Error(`HTTP ${res.status}`);
}

/**
 * SDK client targeting the platform API. Honors SL_API_URL / SL_API_KEY for
 * CI/OSS; otherwise uses the active session token.
 */
async function getPlatformClient(): Promise<SecondLayer> {
	const { apiUrl, ephemeralKey } = await resolveAuth();
	return new SecondLayer({ baseUrl: apiUrl, apiKey: ephemeralKey });
}

// ── Subgraphs ──────────────────────────────────────────────────────────

export async function listSubgraphsApi(): Promise<{ data: SubgraphSummary[] }> {
	return (await getPlatformClient()).subgraphs.list();
}

export async function getSubgraphApi(name: string): Promise<SubgraphDetail> {
	return (await getPlatformClient()).subgraphs.get(name);
}

export async function getSubgraphOpenApi(
	name: string,
	options?: SubgraphSpecOptions,
): Promise<Record<string, unknown>> {
	return (await getPlatformClient()).subgraphs.openapi(name, options);
}

export async function getSubgraphAgentSchema(
	name: string,
	options?: SubgraphSpecOptions,
): Promise<SubgraphAgentSchema> {
	return (await getPlatformClient()).subgraphs.schema(name, options);
}

export async function getSubgraphMarkdown(
	name: string,
	options?: SubgraphSpecOptions,
): Promise<string> {
	return (await getPlatformClient()).subgraphs.markdown(name, options);
}

export async function reindexSubgraphApi(
	name: string,
	options?: { fromBlock?: number; toBlock?: number },
): Promise<ReindexResponse> {
	return (await getPlatformClient()).subgraphs.reindex(name, options);
}

export async function backfillSubgraphApi(
	name: string,
	options: { fromBlock: number; toBlock: number },
): Promise<ReindexResponse> {
	return (await getPlatformClient()).subgraphs.backfill(name, options);
}

export async function stopSubgraphApi(
	name: string,
): Promise<{ message: string }> {
	return (await getPlatformClient()).subgraphs.stop(name);
}

export async function deleteSubgraphApi(
	name: string,
	options?: { force?: boolean },
): Promise<{ message: string }> {
	return (await getPlatformClient()).subgraphs.delete(name, options);
}

export async function deploySubgraphApi(
	data: DeploySubgraphRequest,
): Promise<DeploySubgraphResponse> {
	return (await getPlatformClient()).subgraphs.deploy(data);
}

export async function publishSubgraphApi(
	name: string,
): Promise<{ name: string; visibility: "public"; url: string }> {
	return (await getPlatformClient()).subgraphs.publish(name);
}

export async function unpublishSubgraphApi(
	name: string,
): Promise<{ name: string; visibility: "private" }> {
	return (await getPlatformClient()).subgraphs.unpublish(name);
}

export async function querySubgraphTable(
	name: string,
	table: string,
	params: SubgraphQueryParams = {},
): Promise<unknown[]> {
	return (await getPlatformClient()).subgraphs.queryTable(name, table, params);
}

export async function querySubgraphTableCount(
	name: string,
	table: string,
	params: SubgraphQueryParams = {},
): Promise<{ count: number }> {
	return (await getPlatformClient()).subgraphs.queryTableCount(
		name,
		table,
		params,
	);
}

export async function getSubgraphGaps(
	name: string,
	opts?: { limit?: number; offset?: number; resolved?: boolean },
): Promise<SubgraphGapsResponse> {
	return (await getPlatformClient()).subgraphs.gaps(name, opts);
}

// ── Index ───────────────────────────────────────────────────────────────

/** Empirical per-topic print schema for a contract (anon-ok read; 404 → null). */
export async function getContractPrintSchema(
	contractId: string,
): Promise<PrintSchemaResponse | null> {
	// Open read — when no session/key resolves, fall back to an anonymous
	// client instead of demanding `sl login`.
	let client: SecondLayer;
	try {
		client = await getPlatformClient();
	} catch {
		client = new SecondLayer({ baseUrl: resolveApiUrl() });
	}
	return client.index.printSchema(contractId);
}

// ── Account (platform-scoped, session-authed) ──────────────────────────

export interface AccountProfile {
	id: string;
	email: string;
	plan: string;
	displayName: string | null;
	bio: string | null;
	slug: string | null;
	avatarUrl: string | null;
	notifyReindexComplete: boolean;
	createdAt: string;
}

export async function getAccountProfile(): Promise<AccountProfile> {
	return httpPlatform<AccountProfile>("/api/accounts/me");
}

export async function updateAccountProfile(data: {
	display_name?: string;
	bio?: string;
	slug?: string;
	notify_reindex_complete?: boolean;
}): Promise<{
	id: string;
	email: string;
	displayName: string | null;
	bio: string | null;
	slug: string | null;
	avatarUrl: string | null;
	notifyReindexComplete: boolean;
}> {
	return httpPlatform("/api/accounts/me", { method: "PATCH", body: data });
}
