import { ApiError, apiRequest } from "./api";

/**
 * Server-side helpers for dashboard requests. Post shared-rip (2026-05-14)
 * subgraphs + subscriptions live on the platform API alongside everything
 * else, so these are now thin wrappers over `apiRequest`. Function names
 * preserved so existing dashboard callers compile unchanged.
 */

const API_URL = process.env.SL_API_URL || "http://localhost:3800";

export async function getTenantApiUrl(_sessionToken: string): Promise<string> {
	return API_URL;
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

export async function fetchFromTenant<T = unknown>(
	sessionToken: string,
	path: string,
	options: TenantFetchOptions = {},
): Promise<TenantFetchResult<T>> {
	const qs =
		options.query instanceof URLSearchParams
			? options.query.toString()
			: (options.query ?? "");
	const url = `${API_URL}${path}${qs ? `?${qs}` : ""}`;

	const res = await fetch(url, {
		method: options.method ?? "GET",
		headers: {
			Authorization: `Bearer ${sessionToken}`,
			"Content-Type": "application/json",
			...options.headers,
		},
		body: options.body != null ? JSON.stringify(options.body) : undefined,
	});

	const data = (await res.json().catch(() => ({}) as unknown)) as
		| T
		| { error: string };
	return { ok: res.ok, status: res.status, data };
}

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
