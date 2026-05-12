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

type TenantMeResponse = {
	tenant: {
		slug: string;
		apiUrl: string | null;
		suspendedAt: string | null;
		limitReason: string | null;
	};
};

export abstract class BaseClient {
	protected baseUrl: string;
	protected apiKey?: string;
	protected origin: "cli" | "mcp" | "session";
	protected tenantBaseUrlOverride?: string;
	private _tenantBaseUrlPromise: Promise<string> | null = null;

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
	): Promise<T> {
		const response = await this.fetchResponse(baseUrl, method, path, body);

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
	 * Resolve and cache the tenant API base URL for tenant-resource calls
	 * (subgraphs, subscriptions). On the platform API, those routes are not
	 * mounted — they live on per-tenant containers at
	 * `https://<slug>.api.secondlayer.tools`. This method asks
	 * `/api/tenants/me` (against the platform baseUrl) for the apiUrl that
	 * belongs to the authenticated account.
	 *
	 * The result is cached on the client instance. Failures are NOT cached, so
	 * a flaky platform call doesn't permanently break the SDK.
	 */
	protected getTenantBaseUrl(): Promise<string> {
		if (this.tenantBaseUrlOverride) {
			return Promise.resolve(this.tenantBaseUrlOverride);
		}
		if (!this._tenantBaseUrlPromise) {
			this._tenantBaseUrlPromise = this.resolveTenantBaseUrl().catch((err) => {
				this._tenantBaseUrlPromise = null;
				throw err;
			});
		}
		return this._tenantBaseUrlPromise;
	}

	private async resolveTenantBaseUrl(): Promise<string> {
		const body = await this.request<TenantMeResponse>("GET", "/api/tenants/me");
		const tenant = body.tenant;
		if (tenant.suspendedAt) {
			throw new ApiError(
				403,
				`Tenant ${tenant.slug} is suspended${tenant.limitReason ? `: ${tenant.limitReason}` : ""}.`,
				body,
				"TENANT_SUSPENDED",
			);
		}
		if (!tenant.apiUrl) {
			throw new ApiError(
				404,
				"No tenant API URL available for this account. Provision a tenant at https://secondlayer.tools/platform.",
				body,
				"NO_TENANT",
			);
		}
		return tenant.apiUrl.replace(/\/+$/, "");
	}

	protected async requestAtTenant<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const tenantUrl = await this.getTenantBaseUrl();
		return this.requestAt<T>(tenantUrl, method, path, body);
	}

	protected async requestTextAtTenant(
		method: string,
		path: string,
		body?: unknown,
	): Promise<string> {
		const tenantUrl = await this.getTenantBaseUrl();
		const response = await this.fetchResponse(tenantUrl, method, path, body);
		return response.text();
	}

	private async fetchResponse(
		baseUrl: string,
		method: string,
		path: string,
		body?: unknown,
	): Promise<Response> {
		const url = `${baseUrl}${path}`;
		const headers = BaseClient.authHeaders(this.apiKey);
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
