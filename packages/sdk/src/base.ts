import { ApiError } from "./errors.ts";

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface SecondLayerOptions {
	/** Base URL of the Secondlayer platform API (trailing slashes are stripped). */
	baseUrl: string;
	/** Bearer token for authenticated requests. */
	apiKey?: string;
	/**
	 * Explicit tenant API base URL — bypass the auto-resolution that calls
	 * `/api/tenants/me` on first tenant-resource request. Use when you already
	 * know your tenant URL (OSS, staging, or any custom routing setup).
	 */
	tenantBaseUrl?: string;
	/** Fetch implementation. Tests and edge runtimes can provide their own. */
	fetchImpl?: FetchLike;
	/** Deploy origin label sent as `x-sl-origin` (telemetry). Defaults to `cli`. */
	origin?: "cli" | "mcp" | "session";
}

const DEFAULT_BASE_URL = "https://api.secondlayer.tools";

// Refresh the ephemeral JWT this far before its `expiresAt` to avoid sending
// requests with a token that expires mid-flight.
const TENANT_JWT_REFRESH_BUFFER_MS = 30_000;

type MintEphemeralResponse = {
	apiUrl: string;
	serviceKey: string;
	expiresAt: string;
};

type TenantSession = {
	apiUrl: string;
	token: string;
	expiresAtMs: number;
};

export abstract class BaseClient {
	protected baseUrl: string;
	protected apiKey?: string;
	protected origin: "cli" | "mcp" | "session";
	protected tenantBaseUrlOverride?: string;
	private _tenantSession: TenantSession | null = null;
	private _tenantSessionPromise: Promise<TenantSession> | null = null;

	constructor(options: Partial<SecondLayerOptions> = {}) {
		this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
		this.apiKey = options.apiKey;
		this.origin = options.origin ?? "cli";
		this.tenantBaseUrlOverride = options.tenantBaseUrl?.replace(/\/+$/, "");
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
	): Promise<T> {
		return this.requestAt<T>(this.baseUrl, method, path, body);
	}

	protected async requestAt<T>(
		baseUrl: string,
		method: string,
		path: string,
		body?: unknown,
		authToken?: string,
	): Promise<T> {
		const response = await this.fetchResponse(
			baseUrl,
			method,
			path,
			body,
			authToken,
		);

		if (response.status === 204) {
			return undefined as T;
		}

		return response.json() as Promise<T>;
	}

	protected async requestText(
		method: string,
		path: string,
		body?: unknown,
	): Promise<string> {
		const response = await this.fetchResponse(this.baseUrl, method, path, body);
		return response.text();
	}

	/**
	 * Resolve + cache a tenant session for tenant-resource calls (subgraphs,
	 * subscriptions). On the platform API, those routes are not mounted —
	 * they live on per-tenant containers at `https://<slug>.api.secondlayer.tools`,
	 * which expect a short-lived HS256 JWT (not the platform `sk-sl_*` key).
	 *
	 * `POST /api/tenants/me/keys/mint-ephemeral` returns both the tenant `apiUrl`
	 * and a 5-min `serviceKey` JWT in one round-trip. We cache the session and
	 * refresh before expiry. Failures are NOT cached, so a flaky platform call
	 * doesn't permanently break the SDK.
	 *
	 * Bypass via `tenantBaseUrl` constructor option for OSS / staging / custom
	 * routing where the same `apiKey` works against both surfaces.
	 */
	protected async getTenantSession(): Promise<TenantSession> {
		if (this.tenantBaseUrlOverride) {
			return {
				apiUrl: this.tenantBaseUrlOverride,
				token: this.apiKey ?? "",
				expiresAtMs: Number.POSITIVE_INFINITY,
			};
		}
		const cached = this._tenantSession;
		if (
			cached &&
			cached.expiresAtMs - Date.now() > TENANT_JWT_REFRESH_BUFFER_MS
		) {
			return cached;
		}
		if (!this._tenantSessionPromise) {
			this._tenantSessionPromise = this.mintTenantSession().catch((err) => {
				this._tenantSessionPromise = null;
				throw err;
			});
		}
		return this._tenantSessionPromise;
	}

	/**
	 * Returns just the tenant API base URL. Convenience wrapper around
	 * `getTenantSession` for callers that don't need the auth token (e.g. tests).
	 */
	protected async getTenantBaseUrl(): Promise<string> {
		return (await this.getTenantSession()).apiUrl;
	}

	private async mintTenantSession(): Promise<TenantSession> {
		const body = await this.request<MintEphemeralResponse>(
			"POST",
			"/api/tenants/me/keys/mint-ephemeral",
		);
		if (!body.apiUrl) {
			throw new ApiError(
				404,
				"No tenant API URL available for this account. Provision a tenant at https://secondlayer.tools/platform.",
				body,
				"NO_TENANT",
			);
		}
		if (!body.serviceKey) {
			throw new ApiError(
				500,
				"Tenant mint-ephemeral returned no serviceKey.",
				body,
				"NO_TENANT_TOKEN",
			);
		}
		const session: TenantSession = {
			apiUrl: body.apiUrl.replace(/\/+$/, ""),
			token: body.serviceKey,
			expiresAtMs: Date.parse(body.expiresAt),
		};
		this._tenantSession = session;
		this._tenantSessionPromise = null;
		return session;
	}

	protected async requestAtTenant<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const session = await this.getTenantSession();
		return this.requestAt<T>(session.apiUrl, method, path, body, session.token);
	}

	protected async requestTextAtTenant(
		method: string,
		path: string,
		body?: unknown,
	): Promise<string> {
		const session = await this.getTenantSession();
		const response = await this.fetchResponse(
			session.apiUrl,
			method,
			path,
			body,
			session.token,
		);
		return response.text();
	}

	private async fetchResponse(
		baseUrl: string,
		method: string,
		path: string,
		body?: unknown,
		authToken?: string,
	): Promise<Response> {
		const url = `${baseUrl}${path}`;
		const headers = BaseClient.authHeaders(authToken ?? this.apiKey);
		headers["x-sl-origin"] = this.origin;

		let response: Response;
		try {
			response = await fetch(url, {
				method,
				headers,
				body: body ? JSON.stringify(body) : undefined,
			});
		} catch {
			throw new ApiError(
				0,
				`Cannot reach API at ${baseUrl}. Check your connection or try again.`,
			);
		}

		if (!response.ok) {
			if (response.status === 401) {
				throw new ApiError(401, "API key invalid or expired.");
			}

			if (response.status === 429) {
				const retryAfter = response.headers.get("Retry-After");
				const msg = retryAfter
					? `Rate limited. Wait ${retryAfter} seconds.`
					: "Rate limited. Try again later.";
				throw new ApiError(429, msg);
			}

			if (response.status >= 500) {
				throw new ApiError(
					response.status,
					`Server error. Try again or check status at ${baseUrl}/health`,
				);
			}

			const errorBody = await response.text();
			let message = `HTTP ${response.status}`;
			let parsedBody: unknown = errorBody;
			let code: string | undefined;
			try {
				const json = JSON.parse(errorBody);
				parsedBody = json;
				const err = json.error ?? json.message;
				if (typeof err === "string") {
					message = err;
				} else if (err && typeof err === "object") {
					message = JSON.stringify(err);
				}
				if (typeof json.code === "string") {
					code = json.code;
				}
			} catch {
				if (errorBody) message = errorBody;
			}
			throw new ApiError(response.status, message, parsedBody, code);
		}

		return response;
	}
}
