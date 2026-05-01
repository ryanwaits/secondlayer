import { ApiError, apiRequest } from "./api";

/**
 * Server-side helpers for proxying dashboard requests to the user's
 * tenant API.
 *
 * Post-dedicated-cutover the platform API no longer mounts
 * `/api/subgraphs` etc. — those routes live only on each tenant's own
 * API at `<slug>.secondlayer.tools`. This helper mints a 5-min service
 * JWT via `POST /api/tenants/me/keys/mint-ephemeral` and forwards the
 * request.
 *
 * Mint-ephemeral auto-resumes paused Hobby tenants, so the first hit
 * after idle may take ~20-30s while containers wake up.
 */

interface EphemeralKey {
	apiUrl: string;
	serviceKey: string;
	expiresAt: string;
}

async function mintTenantKey(sessionToken: string): Promise<EphemeralKey> {
	return apiRequest<EphemeralKey>("/api/tenants/me/keys/mint-ephemeral", {
		method: "POST",
		sessionToken,
	});
}

export async function getTenantApiUrl(sessionToken: string): Promise<string> {
	const key = await mintTenantKey(sessionToken);
	return key.apiUrl;
}

export interface TenantFetchOptions {
	method?: string;
	body?: unknown;
	query?: URLSearchParams | string;
	headers?: Record<string, string>;
}

export interface TenantFetchResult<T> {
	ok: boolean;
	status: number;
	data: T | { error: string };
}

/**
 * Fetch from the user's tenant API. `path` is relative to the tenant
 * API root (e.g. `/api/subgraphs` or `/api/subgraphs/my-subgraph`).
 */
export async function fetchFromTenant<T = unknown>(
	sessionToken: string,
	path: string,
	options: TenantFetchOptions = {},
): Promise<TenantFetchResult<T>> {
	let key: EphemeralKey;
	try {
		key = await mintTenantKey(sessionToken);
	} catch (err) {
		if (err instanceof ApiError) {
			return {
				ok: false,
				status: err.status,
				data: { error: err.message },
			};
		}
		return { ok: false, status: 500, data: { error: "Internal error" } };
	}

	const qs =
		options.query instanceof URLSearchParams
			? options.query.toString()
			: (options.query ?? "");
	const url = `${key.apiUrl}${path}${qs ? `?${qs}` : ""}`;

	const res = await fetch(url, {
		method: options.method ?? "GET",
		headers: {
			Authorization: `Bearer ${key.serviceKey}`,
			"Content-Type": "application/json",
			...options.headers,
		},
		body: options.body != null ? JSON.stringify(options.body) : undefined,
	});

	const data = (await res.json().catch(() => ({}) as unknown)) as
		| T
		| {
				error: string;
		  };
	return { ok: res.ok, status: res.status, data };
}

/**
 * RSC-friendly variant that throws on non-2xx so callers can `.catch()`
 * the same way they did with `apiRequest`.
 */
export async function fetchFromTenantOrThrow<T = unknown>(
	sessionToken: string,
	path: string,
	options: TenantFetchOptions = {},
): Promise<T> {
	const result = await fetchFromTenant<T>(sessionToken, path, options);
	if (!result.ok) {
		const message =
			(result.data as { error?: string })?.error ??
			`Request failed (${result.status})`;
		throw new ApiError(result.status, message);
	}
	return result.data as T;
}
