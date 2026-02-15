import { ApiError } from "./errors.ts";

export interface SecondLayerOptions {
  /** Base URL of the Secondlayer API (trailing slashes are stripped). */
  baseUrl: string;
  /** Bearer token for authenticated requests. */
  apiKey?: string;
}

const DEFAULT_BASE_URL = "https://api.secondlayer.io";

export abstract class BaseClient {
  protected baseUrl: string;
  protected apiKey?: string;

  constructor(options: Partial<SecondLayerOptions> = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
  }

  static authHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  protected async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = BaseClient.authHeaders(this.apiKey);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, `Cannot reach API at ${this.baseUrl}. Check your connection or try again.`);
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
        throw new ApiError(response.status, `Server error. Try again or check status at ${this.baseUrl}/health`);
      }

      const errorBody = await response.text();
      let message = `HTTP ${response.status}`;
      try {
        const json = JSON.parse(errorBody);
        message = json.error || json.message || message;
      } catch {
        if (errorBody) message = errorBody;
      }
      throw new ApiError(response.status, message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}
