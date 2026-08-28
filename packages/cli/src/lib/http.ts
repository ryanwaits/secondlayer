import { resolveApiUrl, resolveArchiveOpsUrl } from "./api-url.ts";
import { isOssMode, resolveAuth, resolveEnvKey } from "./resolve-auth.ts";
import { readSession } from "./session.ts";

export { resolveArchiveOpsUrl } from "./api-url.ts";

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
 * Request against an explicit base URL, with or without a bearer. `login`
 * uses this before a session exists (magic-link + verify endpoints) and to
 * check a piped token against the account endpoint.
 */
export async function httpAt<T>(
	baseUrl: string,
	path: string,
	opts: HttpOptions & { bearer?: string } = {},
): Promise<T> {
	return request<T>(`${baseUrl.replace(/\/+$/, "")}${path}`, opts);
}

/**
 * Platform API request without auth. Honors SL_API_URL / SL_PLATFORM_API_URL.
 */
export async function httpPlatformAnon<T>(
	path: string,
	opts: HttpOptions = {},
): Promise<T> {
	return httpAt<T>(resolveApiUrl(), path, opts);
}

export async function httpArchiveOpsAnon<T>(
	path: string,
	opts: HttpOptions = {},
): Promise<T> {
	return httpAt<T>(resolveArchiveOpsUrl(), path, opts);
}

/** The one command that fixes every archive credits auth failure. */
export const ARCHIVE_LOGIN_COMMAND = "secondlayer login --credits";

/**
 * Credentials the archive credits merchant can validate: `sk-sl_` API keys
 * and `ss-sl_` session tokens. An instance token is random hex minted by
 * `secondlayer init` for the operator's own box; the merchant cannot check it
 * and it must never leave the machine.
 */
const ARCHIVE_CREDENTIAL_RE = /^s[ks]-sl_/;

export type ArchiveOpsBearer = {
	bearer: string | undefined;
	source: "session" | "env" | null;
	/** An env credential was set but is not one the merchant accepts. */
	ignoredEnvKey: boolean;
};

/**
 * Bearer for archive credits calls: the login session for the merchant URL
 * first, then an env key only when it is an archive credential. The
 * operator's `INSTANCE_TOKEN` is the common case for a self-hoster and is
 * ignored here on purpose.
 */
export async function resolveArchiveOpsBearer(): Promise<ArchiveOpsBearer> {
	const envKey = resolveEnvKey();
	const session = await readSession(resolveArchiveOpsUrl());
	if (session) {
		return {
			bearer: session.token,
			source: "session",
			ignoredEnvKey: false,
		};
	}
	if (envKey && ARCHIVE_CREDENTIAL_RE.test(envKey)) {
		return { bearer: envKey, source: "env", ignoredEnvKey: false };
	}
	return {
		bearer: undefined,
		source: null,
		ignoredEnvKey: envKey !== undefined,
	};
}

function ignoredEnvKeyNote(ignored: boolean): string {
	return ignored
		? " INSTANCE_TOKEN was ignored: it unlocks this instance, not archive credits."
		: "";
}

export async function httpArchiveOps<T>(
	path: string,
	opts: HttpOptions = {},
): Promise<T> {
	const { bearer, ignoredEnvKey } = await resolveArchiveOpsBearer();
	if (!bearer) {
		throw new CliHttpError(
			401,
			"SESSION_EXPIRED",
			{ error: "Not logged in" },
			`Archive credits need a login. Run \`${ARCHIVE_LOGIN_COMMAND}\`.${ignoredEnvKeyNote(ignoredEnvKey)}`,
		);
	}
	try {
		return await request<T>(`${resolveArchiveOpsUrl()}${path}`, {
			...opts,
			bearer,
		});
	} catch (err) {
		if (err instanceof CliHttpError && err.status === 401) {
			throw new CliHttpError(
				401,
				err.code,
				err.body,
				`Archive credits rejected the login (${err.message}). Run \`${ARCHIVE_LOGIN_COMMAND}\` again.${ignoredEnvKeyNote(ignoredEnvKey)}`,
			);
		}
		throw err;
	}
}
