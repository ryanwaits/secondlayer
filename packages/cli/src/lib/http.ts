import {
	resolveAccountKey,
	resolveApiKey,
	resolveIdentity,
} from "@secondlayer/sdk";
import { resolveApiUrl, resolveArchiveOpsUrl } from "./api-url.ts";
import { isOssMode, resolveAuth } from "./resolve-auth.ts";
import { readSession } from "./session.ts";

export { resolveArchiveOpsUrl } from "./api-url.ts";

/**
 * Typed HTTP client for the platform API.
 *
 * `httpPlatform` resolves auth via `resolveAuth` (env API key or stored session
 * token) and targets `resolveAuth().apiUrl`, so global `--api-key`/`--api-url`
 * and `INSTANCE_TOKEN`/`SECONDLAYER_API_URL` apply uniformly. With a session token the
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
 * Platform API request without auth. Honors SECONDLAYER_API_URL.
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

/** Remedy for every account auth failure: the account key first, the login as the alternative. */
export const ARCHIVE_AUTH_HINT =
	"Set SECONDLAYER_API_KEY to your account key (sk-sl_…, from /account/keys), or run `secondlayer login`.";

export type ArchiveOpsBearer = {
	bearer: string | undefined;
	source: "session" | "env" | null;
	/** An env credential was set but is not one the merchant accepts. */
	ignoredEnvKey: boolean;
};

/**
 * Bearer for hosted account calls (credits, archive fetches), by the shared
 * `resolveIdentity` precedence: an env account key first, then the login
 * session. The operator's `INSTANCE_TOKEN` is the common case for a
 * self-hoster and is ignored here on purpose.
 */
export async function resolveArchiveOpsBearer(): Promise<ArchiveOpsBearer> {
	const envKey = resolveAccountKey();
	const session = await readSession(resolveArchiveOpsUrl());
	const identity = resolveIdentity("account", { session: session?.token });
	return {
		bearer: identity.token,
		source: identity.source === "none" ? null : identity.source,
		ignoredEnvKey:
			identity.source === "none" &&
			resolveApiKey() !== undefined &&
			envKey === undefined,
	};
}

function ignoredEnvKeyNote(ignored: boolean): string {
	return ignored
		? " INSTANCE_TOKEN was ignored: it unlocks this instance, not your account."
		: "";
}

export async function httpArchiveOps<T>(
	path: string,
	opts: HttpOptions = {},
): Promise<T> {
	const { bearer, source, ignoredEnvKey } = await resolveArchiveOpsBearer();
	if (!bearer) {
		throw new CliHttpError(
			401,
			"SESSION_EXPIRED",
			{ error: "Not logged in" },
			`This needs your Secondlayer account. ${ARCHIVE_AUTH_HINT}${ignoredEnvKeyNote(ignoredEnvKey)}`,
		);
	}
	try {
		return await request<T>(`${resolveArchiveOpsUrl()}${path}`, {
			...opts,
			bearer,
		});
	} catch (err) {
		if (err instanceof CliHttpError && err.status === 401) {
			// An env account key beats a saved login; a rejected session means log in again.
			const remedy =
				source === "session"
					? `Your saved login was rejected (${err.message}). Run \`secondlayer login\`, or set SECONDLAYER_API_KEY (it takes precedence over a saved login).`
					: `Your account rejected the credential (${err.message}). ${ARCHIVE_AUTH_HINT}${ignoredEnvKeyNote(ignoredEnvKey)}`;
			throw new CliHttpError(401, err.code, err.body, remedy);
		}
		throw err;
	}
}
