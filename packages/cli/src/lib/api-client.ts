import { ApiError, SecondLayer } from "@secondlayer/sdk";
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
import { resolveAuth } from "./resolve-auth.ts";

export { ApiError };
export type { SubgraphQueryParams } from "@secondlayer/shared/schemas";

/**
 * Shared error handler. Maps typed codes to user-facing hints.
 */
export function handleApiError(err: unknown, action: string): never {
	if (err instanceof CliHttpError) {
		if (err.code === "SESSION_EXPIRED") {
			console.error("Session expired. Run: sl login");
			process.exit(1);
		}
	}
	if (err instanceof ApiError && err.status === 401) {
		console.error("Authentication required. Run: sl login");
		process.exit(1);
	}
	console.error(`Error: Failed to ${action}: ${err}`);
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
 * SDK client targeting the platform API with the caller's session token.
 * SDK client targeting the platform API. Honors SL_API_URL / SL_SERVICE_KEY
 * for CI/OSS; otherwise uses the active session token.
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

// ── Account (platform-scoped, session-authed) ──────────────────────────

export interface AccountProfile {
	id: string;
	email: string;
	plan: string;
	displayName: string | null;
	bio: string | null;
	slug: string | null;
	avatarUrl: string | null;
	createdAt: string;
}

export async function getAccountProfile(): Promise<AccountProfile> {
	return httpPlatform<AccountProfile>("/api/accounts/me");
}

export async function updateAccountProfile(data: {
	display_name?: string;
	bio?: string;
	slug?: string;
}): Promise<{
	id: string;
	email: string;
	displayName: string | null;
	bio: string | null;
	slug: string | null;
	avatarUrl: string | null;
}> {
	return httpPlatform("/api/accounts/me", { method: "PATCH", body: data });
}
