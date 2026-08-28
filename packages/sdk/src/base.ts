import {
	ApiError,
	AuthError,
	RateLimitError,
	parseRetryAfter,
} from "./errors.ts";

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface SecondLayerOptions {
	/** Base URL of the instance API (trailing slashes are stripped). */
	baseUrl: string;
	/** Bearer token for authenticated requests. */
	apiKey?: string;
	/** Fetch implementation. Tests and edge runtimes can provide their own. */
	fetchImpl?: FetchLike;
	/** Public base URL for Streams bulk parquet dumps (the cold backfill plane).
	 *  Required for `streams.dumps.*`; without it the dumps client falls back to
	 *  its built-in default. */
	dumpsBaseUrl?: string;
	/** Deploy origin label sent as `x-sl-origin` (telemetry). Defaults to `cli`. */
	origin?: "cli" | "mcp" | "session";
	/** Check the ed25519 signature on every Streams read. Omit for lenient
	 *  (verify when signed, pass through unsigned self-host responses), `true`
	 *  or `{ publicKey }` for strict, `false` for off. Reaches `sl.streams`. */
	verify?: boolean | { publicKey: string };
	/** Check the dumps manifest signature before trusting any file hash
	 *  (default on). Reaches `sl.streams.dumps`. */
	verifyDumpsManifest?: boolean;
	/** How long one request may take, headers and body, before it fails with a
	 *  retryable `ApiError` (default 30 000 ms). A hung socket then trips the
	 *  retry policy instead of stalling a walk or consume loop forever. `0`
	 *  disables the timeout. */
	requestTimeoutMs?: number;
}

/** Default per-request budget. Long enough for a 1000-row filtered page on a
 *  cold cache, short enough that a half-open connection surfaces as a retry. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Per-call options every `request*` method accepts. */
export type RequestOptions = {
	/** Cancels the in-flight request (and its body read). The rejection is the
	 *  signal's reason, an `AbortError` by default, never an `ApiError`. */
	signal?: AbortSignal;
};

/** The rejection a caller abort produces when the signal carries no reason. */
export function abortError(): Error {
	return new DOMException("This operation was aborted", "AbortError");
}

/** Reject as soon as `signal` aborts, even when `promise` is a fetch
 *  implementation that ignores its `signal` argument. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason ?? abortError());
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
	});
}

/** Product default: the local one-box API. Override with `baseUrl` or `SL_API_URL`. */
export const LOCAL_API_URL = "http://127.0.0.1:3800";

export function resolveBaseUrl(explicit?: string): string {
	if (explicit && explicit.length > 0) return explicit.replace(/\/+$/, "");
	if (typeof process !== "undefined") {
		const fromEnv = process.env?.SL_API_URL || process.env?.SECONDLAYER_API_URL;
		if (fromEnv) return fromEnv.replace(/\/+$/, "");
	}
	return LOCAL_API_URL;
}

/** Credential env vars, highest precedence first. `INSTANCE_TOKEN` is the
 *  canonical name — it is what `secondlayer init` writes into `.env.local` and
 *  what the instance API validates bearer tokens against. `SL_API_KEY` is a
 *  legacy alias, kept working so existing exports and CI secrets don't break. */
export const CREDENTIAL_ENV_VARS = ["INSTANCE_TOKEN", "SL_API_KEY"] as const;

/** Conflicting pairs already warned about, so a process with a genuine
 *  misconfiguration says so once rather than on every client construction. */
const warnedConflicts = new Set<string>();

/** Resolve the credential a client should use. Precedence, highest first:
 *
 *   1. an explicit `apiKey` option — including an explicit `""`, which is how
 *      you opt a client back into keyless reads on a machine that has a key
 *      exported;
 *   2. `INSTANCE_TOKEN` — the canonical credential var, shared with the CLI
 *      and MCP server;
 *   3. `SL_API_KEY` — legacy alias for the same value.
 *
 *  Env values that are empty strings count as unset. Falling back to the env at
 *  all is what stops `new Index()` from silently running keyless and 402-ing on
 *  the first deep-history read.
 *
 *  When both env vars are set to *different* non-empty values there is no
 *  correct silent answer, so `INSTANCE_TOKEN` wins and we warn once on stderr —
 *  the whole point of this precedence is that a misconfigured credential should
 *  never authenticate as nobody without saying so.
 *
 *  Guarded for browsers and edge runtimes, where `process` is undefined. */
export function resolveApiKey(apiKey?: string): string | undefined {
	if (apiKey !== undefined) return apiKey;
	if (typeof process === "undefined") return undefined;
	const instanceToken = process.env?.INSTANCE_TOKEN || undefined;
	const legacyKey = process.env?.SL_API_KEY || undefined;
	if (instanceToken && legacyKey && instanceToken !== legacyKey) {
		const pair = `${instanceToken}\u0000${legacyKey}`;
		if (!warnedConflicts.has(pair)) {
			warnedConflicts.add(pair);
			console.warn(
				"[secondlayer] INSTANCE_TOKEN and SL_API_KEY are set to different values — using INSTANCE_TOKEN (SL_API_KEY is a legacy alias for it).",
			);
		}
	}
	return instanceToken ?? legacyKey;
}

/** Percent-encode one URL path segment. Every caller-supplied identifier
 *  (subgraph name, table, subscription id) goes through this before it is
 *  interpolated into a path, so `..`, `/`, `?` and `#` in an id cannot
 *  retarget the authenticated request at a different route. */
export function seg(value: string | number): string {
	return encodeURIComponent(String(value));
}

/** Build a query-string suffix from name→value pairs. Skips null/undefined and
 *  empty values; arrays are comma-joined. Returns "" (never a dangling "?") or
 *  "?a=1&b=2" — the one canonical builder every list endpoint shares, so the
 *  empty-query guard can't be forgotten per call site. */
export function buildQuery(
	params: Record<
		string,
		number | string | boolean | readonly string[] | null | undefined
	>,
): string {
	const search = new URLSearchParams();
	for (const [name, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue;
		const serialized = Array.isArray(value) ? value.join(",") : String(value);
		if (serialized.length === 0) continue;
		search.set(name, serialized);
	}
	const query = search.toString();
	return query ? `?${query}` : "";
}

/** Pull the message and code out of an API error body. The API answers every
 *  failure with `{error, code}`; a proxy in front of it may answer with plain
 *  text or nothing, so the body is kept whichever shape it took and the
 *  message is left undefined when there is none worth surfacing. */
export function parseErrorEnvelope(text: string): {
	message?: string;
	code?: string;
	body: unknown;
} {
	if (text.length === 0) return { body: undefined };
	try {
		const json = JSON.parse(text);
		let message: string | undefined;
		let code: string | undefined;
		if (json && typeof json === "object") {
			const err = json.error ?? json.message;
			if (typeof err === "string" && err.length > 0) message = err;
			else if (err && typeof err === "object") message = JSON.stringify(err);
			if (typeof json.code === "string") code = json.code;
		}
		return { message, code, body: json };
	} catch {
		return { message: text, body: text };
	}
}

export abstract class BaseClient {
	protected baseUrl: string;
	protected apiKey?: string;
	protected origin: "cli" | "mcp" | "session";
	protected fetchImpl: FetchLike;
	protected requestTimeoutMs: number;

	constructor(options: Partial<SecondLayerOptions> = {}) {
		this.baseUrl = resolveBaseUrl(options.baseUrl);
		this.apiKey = resolveApiKey(options.apiKey);
		this.origin = options.origin ?? "cli";
		this.requestTimeoutMs =
			options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		// Bind the global so a bare `fetch` reference doesn't lose its Request
		// context on runtimes where fetch is a method (workerd, older Node).
		this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
	}

	static authHeaders(apiKey?: string): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (apiKey) {
			headers.Authorization = `Bearer ${apiKey}`;
		}
		return headers;
	}

	protected async request<T>(
		method: string,
		path: string,
		body?: unknown,
		opts: RequestOptions = {},
	): Promise<T> {
		return this.withRequestBudget(opts.signal, async (signal) => {
			const response = await this.fetchResponse(method, path, body, signal);
			if (response.status === 204) {
				return undefined as T;
			}
			return (await raceAbort(response.json(), signal)) as T;
		});
	}

	/** Like `request`, but maps a 404 to `null` instead of throwing — the one
	 *  place that owns the "absent resource" rule for `get*` accessors. */
	protected async requestOrNull<T>(
		method: string,
		path: string,
		body?: unknown,
		opts: RequestOptions = {},
	): Promise<T | null> {
		try {
			return await this.request<T>(method, path, body, opts);
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) return null;
			throw err;
		}
	}

	protected async requestText(
		method: string,
		path: string,
		body?: unknown,
		opts: RequestOptions = {},
	): Promise<string> {
		return this.withRequestBudget(opts.signal, async (signal) => {
			const response = await this.fetchResponse(method, path, body, signal);
			return raceAbort(response.text(), signal);
		});
	}

	/** Run one request under the caller's signal plus the per-request timeout.
	 *  One combined signal covers the fetch and the body read, so a socket that
	 *  stalls mid-body times out the same way one that never answers does. A
	 *  timeout rejects with a retryable `ApiError`; a caller abort rejects with
	 *  the signal's reason so loops can tell "stop" from "try again". */
	private async withRequestBudget<T>(
		callerSignal: AbortSignal | undefined,
		run: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		const controller = new AbortController();
		let timedOut = false;
		const forward = () =>
			controller.abort(callerSignal?.reason ?? abortError());
		if (callerSignal?.aborted) forward();
		else callerSignal?.addEventListener("abort", forward, { once: true });
		const timer =
			this.requestTimeoutMs > 0
				? setTimeout(() => {
						timedOut = true;
						controller.abort(abortError());
					}, this.requestTimeoutMs)
				: undefined;
		try {
			return await run(controller.signal);
		} catch (err) {
			if (timedOut && !callerSignal?.aborted) {
				throw new ApiError(
					0,
					`No response from ${this.baseUrl} within ${this.requestTimeoutMs}ms. Retryable. Raise requestTimeoutMs for slow filtered reads.`,
					undefined,
					"REQUEST_TIMEOUT",
					{ retryable: true, cause: err instanceof Error ? err : undefined },
				);
			}
			throw err;
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			callerSignal?.removeEventListener("abort", forward);
		}
	}

	/** Issue the HTTP request and map non-2xx statuses onto the error family.
	 *  `signal` is the combined caller-plus-timeout signal from `request*`;
	 *  subclasses that stream a body call this directly and read it themselves. */
	protected async fetchResponse(
		method: string,
		path: string,
		body?: unknown,
		signal?: AbortSignal,
	): Promise<Response> {
		const url = `${this.baseUrl}${path}`;
		const headers = BaseClient.authHeaders(this.apiKey);
		headers["x-sl-origin"] = this.origin;

		// Serialize the body BEFORE the network try so a body-encoding error
		// (e.g. unsupported BigInt) isn't misreported as "Cannot reach API".
		// BigInts are stringified — server schemas accept jsonb so the value
		// reaches the server intact, and any field that needs an actual bigint
		// at runtime is rehydrated by the consuming module (subgraph handler
		// code preserves the literal). See packages/subgraphs source-matcher
		// for the post-load shape.
		let serializedBody: string | undefined;
		if (body !== undefined && body !== null) {
			try {
				serializedBody = JSON.stringify(body, (_key, value) =>
					typeof value === "bigint" ? value.toString() : value,
				);
			} catch (err) {
				const detail = err instanceof Error ? err.message : String(err);
				// Not retryable: the same body will fail to serialize again.
				throw new ApiError(
					0,
					`Failed to serialize request body: ${detail}`,
					undefined,
					undefined,
					{ retryable: false },
				);
			}
		}

		let response: Response;
		try {
			const pending = this.fetchImpl(url, {
				method,
				headers,
				body: serializedBody,
				signal,
			});
			response = signal ? await raceAbort(pending, signal) : await pending;
		} catch (err) {
			// An abort (caller or timeout) is not a network failure; let the
			// budget wrapper decide what it means.
			if (signal?.aborted) throw err;
			throw new ApiError(
				0,
				`Cannot reach API at ${this.baseUrl}. Check your connection or try again.`,
				undefined,
				undefined,
				{ retryable: true, cause: err instanceof Error ? err : undefined },
			);
		}

		if (!response.ok) {
			// Read the envelope once for every failure status. The API answers
			// 401 and 503 with `{error, code}` too (a revoked token, an index
			// still catching up), and that code is what a caller branches on.
			const errorBody = signal
				? await raceAbort(response.text(), signal)
				: await response.text();
			const envelope = parseErrorEnvelope(errorBody);
			const retryAfter = response.headers.get("Retry-After") ?? undefined;

			if (response.status === 401) {
				throw new AuthError(
					envelope.message ?? "API key invalid or expired.",
					envelope.body,
					envelope.code,
				);
			}

			if (response.status === 429) {
				// The header is preserved as `retryAfterSeconds` (not just prose) so
				// the consume loops can honor it.
				const fallback = retryAfter
					? `Rate limited. Wait ${retryAfter} seconds.`
					: "Rate limited. Try again later.";
				throw new RateLimitError(
					envelope.message ?? fallback,
					retryAfter,
					envelope.body,
					envelope.code,
				);
			}

			if (response.status >= 500) {
				const retryAfterSeconds = parseRetryAfter(retryAfter);
				throw new ApiError(
					response.status,
					envelope.message ??
						`Server error. Try again or check status at ${this.baseUrl}/health`,
					envelope.body,
					envelope.code,
					retryAfterSeconds !== undefined ? { retryAfterSeconds } : {},
				);
			}

			throw new ApiError(
				response.status,
				envelope.message ?? `HTTP ${response.status}`,
				envelope.body,
				envelope.code,
			);
		}

		return response;
	}
}
