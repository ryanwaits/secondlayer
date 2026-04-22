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
import { CliHttpError, httpPlatform } from "./http.ts";
import { resolveActiveTenant } from "./resolve-tenant.ts";

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
		if (err.code === "TENANT_SUSPENDED") {
			console.error("Tenant is suspended. Run: sl instance resume");
			process.exit(1);
		}
		if (err.code === "NO_TENANT_FOR_PROJECT") {
			console.error(err.message);
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
 * Returns an SDK client targeting the caller's tenant with a short-lived
 * ephemeral service key. Resolves via `resolveActiveTenant` — honors
 * SL_API_URL / SL_SERVICE_KEY env-var bypass for CI/OSS.
 */
async function getTenantClient(): Promise<SecondLayer> {
	const { apiUrl, ephemeralKey } = await resolveActiveTenant();
	return new SecondLayer({ baseUrl: apiUrl, apiKey: ephemeralKey });
}

/**
 * Auth headers for raw fetch() against tenant endpoints — uses an ephemeral
 * JWT. Prefer `httpTenant` from `./http.ts` for new code; this exists for
 * callers still building raw fetch() requests.
 */
export async function tenantAuthHeaders(): Promise<Record<string, string>> {
	const { ephemeralKey } = await resolveActiveTenant();
	return SecondLayer.authHeaders(ephemeralKey);
}

/** Back-compat alias. Prefer `tenantAuthHeaders` or `httpTenant`. */
export async function authHeaders(): Promise<Record<string, string>> {
	return tenantAuthHeaders();
}

// ── Subgraphs (tenant-scoped) ──────────────────────────────────────────

export async function listSubgraphsApi(): Promise<{ data: SubgraphSummary[] }> {
	return (await getTenantClient()).subgraphs.list();
}

export async function getSubgraphApi(name: string): Promise<SubgraphDetail> {
	return (await getTenantClient()).subgraphs.get(name);
}

export async function reindexSubgraphApi(
	name: string,
	options?: { fromBlock?: number; toBlock?: number },
): Promise<ReindexResponse> {
	return (await getTenantClient()).subgraphs.reindex(name, options);
}

export async function backfillSubgraphApi(
	name: string,
	options: { fromBlock: number; toBlock: number },
): Promise<ReindexResponse> {
	return (await getTenantClient()).subgraphs.backfill(name, options);
}

export async function stopSubgraphApi(
	name: string,
): Promise<{ message: string }> {
	return (await getTenantClient()).subgraphs.stop(name);
}

export async function deleteSubgraphApi(
	name: string,
): Promise<{ message: string }> {
	return (await getTenantClient()).subgraphs.delete(name);
}

export async function deploySubgraphApi(
	data: DeploySubgraphRequest,
): Promise<DeploySubgraphResponse> {
	return (await getTenantClient()).subgraphs.deploy(data);
}

export async function querySubgraphTable(
	name: string,
	table: string,
	params: SubgraphQueryParams = {},
): Promise<unknown[]> {
	return (await getTenantClient()).subgraphs.queryTable(name, table, params);
}

export async function querySubgraphTableCount(
	name: string,
	table: string,
	params: SubgraphQueryParams = {},
): Promise<{ count: number }> {
	return (await getTenantClient()).subgraphs.queryTableCount(
		name,
		table,
		params,
	);
}

export async function getSubgraphGaps(
	name: string,
	opts?: { limit?: number; offset?: number; resolved?: boolean },
): Promise<SubgraphGapsResponse> {
	return (await getTenantClient()).subgraphs.gaps(name, opts);
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
