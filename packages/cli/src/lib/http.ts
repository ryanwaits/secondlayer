import {
	ARCHIVE_OPS_API_URL,
	isOssMode,
	resolveApiUrl,
	resolveAuth,
	resolveEnvKey,
} from "./resolve-auth.ts";
import { readSession } from "./session.ts";

/**
 * Typed HTTP client for the platform API.
 *
 * `httpPlatform` resolves auth via `resolveAuth` (env API key or stored session
 * token) and targets `resolveAuth().apiUrl`, so global `--api-key`/`--api-url`
 * and `INSTANCE_TOKEN`/`SL_API_URL` apply uniformly. With a session token the
 * server auto-extends the 90d expiry on every request (sliding window in
 * packages/api/src/auth/middleware.ts), so no refresh logic lives here.
 *
 * Throws `CliHttpError` on non-2xx with a typed `code` so command handlers
 * can match on specific backend codes (`SESSION_EXPIRED`, etc.).
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

const REQUEST_TIMEOUT_MS = 30_000;

export interface HttpOptions {
	method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
	body?: unknown;
	headers?: Record<string, string>;
	timeoutMs?: number;
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
		signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
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
	let auth: Awaited<ReturnType<typeof resolveAuth>>;
	try {
		auth = await resolveAuth();
	} catch {
		throw new CliHttpError(
			401,
			"SESSION_EXPIRED",
			{ error: "Not logged in" },
			isOssMode()
				? "Not authenticated — set INSTANCE_TOKEN from `secondlayer init`"
				: "Not logged in — run `secondlayer login`",
		);
	}
	return request<T>(`${auth.apiUrl}${path}`, {
		...opts,
		bearer: auth.ephemeralKey,
	});
}

/**
 * Platform API request without auth — used by `secondlayer login` before a session
 * exists (magic-link + verify endpoints). Honors SL_API_URL / SL_PLATFORM_API_URL.
 */
export async function httpPlatformAnon<T>(
	path: string,
	opts: HttpOptions = {},
): Promise<T> {
	return request<T>(`${resolveApiUrl()}${path}`, opts);
}

/** Merchant API that sells archive credits. Not the operator's loopback box. */
export function resolveArchiveOpsUrl(): string {
	return (process.env.SL_CREDITS_API_URL ?? ARCHIVE_OPS_API_URL).replace(
		/\/+$/,
		"",
	);
}

export async function httpArchiveOpsAnon<T>(
	path: string,
	opts: HttpOptions = {},
): Promise<T> {
	return request<T>(`${resolveArchiveOpsUrl()}${path}`, opts);
}

export async function httpArchiveOps<T>(
	path: string,
	opts: HttpOptions = {},
): Promise<T> {
	const envKey = resolveEnvKey();
	const session = envKey ? null : await readSession();
	const bearer = envKey ?? session?.token;
	if (!bearer) {
		throw new CliHttpError(
			401,
			"SESSION_EXPIRED",
			{ error: "Not logged in" },
			"Not logged in — run `SL_API_URL=https://api.secondlayer.tools secondlayer login`",
		);
	}
	return request<T>(`${resolveArchiveOpsUrl()}${path}`, {
		...opts,
		bearer,
	});
}
