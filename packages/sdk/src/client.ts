import type {
  CreateStream,
  UpdateStream,
  StreamResponse,
  CreateStreamResponse,
  ListStreamsResponse,
  BulkPauseResponse,
  BulkResumeResponse,
  ViewSummary,
  ViewDetail,
  ViewQueryParams,
  ReindexResponse,
} from "@secondlayer/shared/schemas";
import type { DeployViewRequest, DeployViewResponse } from "@secondlayer/shared/schemas/views";
import type { QueueStats } from "@secondlayer/shared/types";
import { ApiError } from "./errors.ts";

/** Configuration for {@link StreamsClient}. */
export interface StreamsClientOptions {
  /** Base URL of the Secondlayer API (trailing slashes are stripped). */
  baseUrl: string;
  /** Bearer token for authenticated requests. */
  apiKey?: string;
}

/**
 * HTTP client for the Secondlayer Streams and Views API.
 * Handles authentication, partial stream ID resolution, and typed responses.
 *
 * @example
 * ```ts
 * const client = new StreamsClient({
 *   baseUrl: "https://api.secondlayer.io",
 *   apiKey: process.env.SECONDLAYER_API_KEY,
 * });
 *
 * const { streams } = await client.listStreams();
 * const view = await client.getView("my-view");
 * ```
 */
export class StreamsClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(options: StreamsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  static authHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = StreamsClient.authHeaders(this.apiKey);

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

  private async requestWithStreamId<T>(
    method: string,
    pathTemplate: (id: string) => string,
    id: string,
    body?: unknown
  ): Promise<T> {
    const fullId = await this.resolveStreamId(id);
    return this.request<T>(method, pathTemplate(fullId), body);
  }

  // ── Stream ID Resolution ──────────────────────────────────────────────

  async resolveStreamId(partialId: string): Promise<string> {
    if (partialId.length === 36 && partialId.includes("-")) {
      return partialId;
    }

    const { streams } = await this.listStreams();
    const typedStreams = streams as { id: string }[];
    const matches = typedStreams.filter((s) => s.id.startsWith(partialId));

    if (matches.length === 0) {
      throw new ApiError(404, `No stream found matching "${partialId}"`);
    }
    if (matches.length > 1) {
      throw new ApiError(400, `Multiple streams match "${partialId}": ${matches.map((s) => s.id.slice(0, 8)).join(", ")}`);
    }

    return matches[0]!.id;
  }

  // ── Streams ───────────────────────────────────────────────────────────

  /** Create a new stream with the given configuration. */
  async createStream(data: CreateStream): Promise<CreateStreamResponse> {
    return this.request<CreateStreamResponse>("POST", "/api/streams", data);
  }

  /** Update an existing stream by ID (supports partial IDs). */
  async updateStream(id: string, data: UpdateStream): Promise<StreamResponse> {
    return this.requestWithStreamId("PATCH", (id) => `/api/streams/${id}`, id, data);
  }

  async updateStreamByName(name: string, data: CreateStream): Promise<StreamResponse> {
    const { streams } = await this.listStreams();
    const typedStreams = streams as { id: string; name: string }[];
    const existing = typedStreams.find((s) => s.name === name);
    if (!existing) {
      throw new ApiError(404, `Stream with name "${name}" not found`);
    }
    return this.updateStream(existing.id, data);
  }

  /** List all streams, optionally filtered by status. */
  async listStreams(params?: { status?: string }): Promise<ListStreamsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    const query = searchParams.toString();
    const path = query ? `/api/streams?${query}` : "/api/streams";
    return this.request<ListStreamsResponse>("GET", path);
  }

  async getStream(id: string): Promise<StreamResponse> {
    return this.requestWithStreamId("GET", (id) => `/api/streams/${id}`, id);
  }

  async deleteStream(id: string): Promise<void> {
    return this.requestWithStreamId("DELETE", (id) => `/api/streams/${id}`, id);
  }

  async enableStream(id: string): Promise<StreamResponse> {
    return this.requestWithStreamId("POST", (id) => `/api/streams/${id}/enable`, id);
  }

  async disableStream(id: string): Promise<StreamResponse> {
    return this.requestWithStreamId("POST", (id) => `/api/streams/${id}/disable`, id);
  }

  async rotateSecret(id: string): Promise<{ secret: string }> {
    return this.requestWithStreamId("POST", (id) => `/api/streams/${id}/rotate-secret`, id);
  }

  async pauseAll(): Promise<BulkPauseResponse> {
    return this.request<BulkPauseResponse>("POST", "/api/streams/pause");
  }

  async resumeAll(): Promise<BulkResumeResponse> {
    return this.request<BulkResumeResponse>("POST", "/api/streams/resume");
  }

  // ── Queue ─────────────────────────────────────────────────────────────

  async getQueueStats(): Promise<QueueStats> {
    const status = await this.request<{ queue: QueueStats }>("GET", "/status");
    return status.queue;
  }

  // ── Views ─────────────────────────────────────────────────────────────

  async listViews(): Promise<{ data: ViewSummary[] }> {
    return this.request<{ data: ViewSummary[] }>("GET", "/api/views");
  }

  async getView(name: string): Promise<ViewDetail> {
    return this.request<ViewDetail>("GET", `/api/views/${name}`);
  }

  async reindexView(name: string, options?: { fromBlock?: number; toBlock?: number }): Promise<ReindexResponse> {
    return this.request<ReindexResponse>("POST", `/api/views/${name}/reindex`, options);
  }

  async deleteView(name: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("DELETE", `/api/views/${name}`);
  }

  async deployView(data: DeployViewRequest): Promise<DeployViewResponse> {
    return this.request<DeployViewResponse>("POST", "/api/views", data);
  }

  async queryTable(name: string, table: string, params: ViewQueryParams = {}): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/api/views/${name}/${table}${buildViewQueryString(params)}`);
  }

  async queryTableCount(name: string, table: string, params: ViewQueryParams = {}): Promise<{ count: number }> {
    return this.request<{ count: number }>("GET", `/api/views/${name}/${table}/count${buildViewQueryString(params)}`);
  }
}

function buildViewQueryString(params: ViewQueryParams): string {
  const qs = new URLSearchParams();
  if (params.sort) qs.set("_sort", params.sort);
  if (params.order) qs.set("_order", params.order);
  if (params.limit !== undefined) qs.set("_limit", String(params.limit));
  if (params.offset !== undefined) qs.set("_offset", String(params.offset));
  if (params.fields) qs.set("_fields", params.fields);
  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      qs.set(key, value);
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}
