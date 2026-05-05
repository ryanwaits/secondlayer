import { ApiError } from "./errors.ts";

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface SecondLayerOptions {
	/** Base URL of the Secondlayer API (trailing slashes are stripped). */
	baseUrl: string;
	/** Bearer token for authenticated requests. */
	apiKey?: string;
	/** Fetch implementation. Tests and edge runtimes can provide their own. */
	fetchImpl?: FetchLike;
	/** Deploy origin label sent as `x-sl-origin` (telemetry). Defaults to `cli`. */
	origin?: "cli" | "mcp" | "session";
}

const DEFAULT_BASE_URL = "https://api.secondlayer.tools";

export abstract class BaseClient {
	protected baseUrl: string;
	protected apiKey?: string;
	protected origin: "cli" | "mcp" | "session";

	constructor(options: Partial<SecondLayerOptions> = {}) {
		this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
		this.apiKey = options.apiKey;
		this.origin = options.origin ?? "cli";
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
		const response = await this.fetchResponse(method, path, body);

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
		const response = await this.fetchResponse(method, path, body);
		return response.text();
	}

	private async fetchResponse(
		method: string,
		path: string,
		body?: unknown,
	): Promise<Response> {
		const url = `${this.baseUrl}${path}`;
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
				`Cannot reach API at ${this.baseUrl}. Check your connection or try again.`,
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
					`Server error. Try again or check status at ${this.baseUrl}/health`,
				);
			}

			const errorBody = await response.text();
			let message = `HTTP ${response.status}`;
			let parsedBody: unknown = errorBody;
			try {
				const json = JSON.parse(errorBody);
				parsedBody = json;
				const err = json.error ?? json.message;
				if (typeof err === "string") {
					message = err;
				} else if (err && typeof err === "object") {
					message = JSON.stringify(err);
				}
			} catch {
				if (errorBody) message = errorBody;
			}
			throw new ApiError(response.status, message, parsedBody);
		}

		return response;
	}
}
