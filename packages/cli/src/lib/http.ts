import { readSession } from "./session.ts";

/**
 * Typed HTTP client for the platform API and per-tenant APIs.
 *
 * `httpPlatform` uses the stored session token; the server auto-extends the
 * 90d expiry on every request (sliding window in packages/auth/src/middleware.ts),
 * so no refresh logic lives here.
 *
 * `httpTenant` takes an explicit bearer — the caller (usually the resolver)
 * has already minted an ephemeral service JWT.
 *
 * Both functions throw `CliHttpError` on non-2xx with a typed `code` so
 * command handlers can match on specific backend codes (`TRIAL_EXPIRED`,
 * `TENANT_SUSPENDED`, `SESSION_EXPIRED`, `KEY_ROTATED`, etc.).
 */

export interface CliHttpErrorBody {
	code?: string;
	error?: string;
	message?: string;
	detail?: string;
	[k: string]: unknown;
}

export class CliHttpError extends Error {
	override readonly name = "CliHttpError";
	constructor(
		readonly status: number,
		readonly code: string,
		readonly body: CliHttpErrorBody,
		message: string,
	) {
		super(message);
	}
}

const PLATFORM_API_URL =
	process.env.SL_PLATFORM_API_URL ?? "https://api.secondlayer.tools";

export interface HttpOptions {
	method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
	body?: unknown;
	headers?: Record<string, string>;
}

async function request<T>(
	url: string,
	opts: HttpOptions & { bearer?: string },
): Promise<T> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
		...(opts.headers ?? {}),
	};
	if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;

	const res = await fetch(url, {
		method: opts.method ?? "GET",
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
	});

	if (!res.ok) {
		let body: CliHttpErrorBody = {};
		try {
			body = (await res.json()) as CliHttpErrorBody;
		} catch {
			body = { error: await res.text().catch(() => "") };
		}
		const code =
			body.code ??
			(res.status === 401
				? "SESSION_EXPIRED"
				: res.status === 404
					? "NOT_FOUND"
					: `HTTP_${res.status}`);
		const message = body.message ?? body.error ?? `HTTP ${res.status}`;
		throw new CliHttpError(res.status, code, body, message);
	}

	// 204 / empty
	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}

export async function httpPlatform<T>(
	path: string,
	opts: HttpOptions = {},
): Promise<T> {
	const session = await readSession();
	if (!session) {
		throw new CliHttpError(
			401,
			"SESSION_EXPIRED",
			{ error: "Not logged in" },
			"Not logged in — run `sl login`",
		);
	}
	return request<T>(`${PLATFORM_API_URL}${path}`, {
		...opts,
		bearer: session.token,
	});
}

export async function httpTenant<T>(
	tenantUrl: string,
	path: string,
	bearer: string,
	opts: HttpOptions = {},
): Promise<T> {
	return request<T>(`${tenantUrl.replace(/\/$/, "")}${path}`, {
		...opts,
		bearer,
	});
}

/**
 * Platform API request without auth — used by `sl login` before a session
 * exists (magic-link + verify endpoints).
 */
export async function httpPlatformAnon<T>(
	path: string,
	opts: HttpOptions = {},
): Promise<T> {
	return request<T>(`${PLATFORM_API_URL}${path}`, opts);
}
