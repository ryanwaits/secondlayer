import type {
  CreateStream,
  UpdateStream,
  StreamResponse,
  CreateStreamResponse,
  ListStreamsResponse,
  BulkPauseResponse,
  BulkResumeResponse,
} from "@secondlayer/shared/schemas";
import { ApiError } from "../errors.ts";
import { BaseClient } from "../base.ts";

export class Streams extends BaseClient {
  private async requestWithStreamId<T>(
    method: string,
    pathTemplate: (id: string) => string,
    id: string,
    body?: unknown
  ): Promise<T> {
    const fullId = await this.resolveStreamId(id);
    return this.request<T>(method, pathTemplate(fullId), body);
  }

  async resolveStreamId(partialId: string): Promise<string> {
    if (partialId.length === 36 && partialId.includes("-")) {
      return partialId;
    }

    const { streams } = await this.list();
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

  async create(data: CreateStream): Promise<CreateStreamResponse> {
    return this.request<CreateStreamResponse>("POST", "/api/streams", data);
  }

  async update(id: string, data: UpdateStream): Promise<StreamResponse> {
    return this.requestWithStreamId("PATCH", (id) => `/api/streams/${id}`, id, data);
  }

  async updateByName(name: string, data: CreateStream): Promise<StreamResponse> {
    const { streams } = await this.list();
    const typedStreams = streams as { id: string; name: string }[];
    const existing = typedStreams.find((s) => s.name === name);
    if (!existing) {
      throw new ApiError(404, `Stream with name "${name}" not found`);
    }
    return this.update(existing.id, data);
  }

  async list(params?: { status?: string }): Promise<ListStreamsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    const query = searchParams.toString();
    const path = query ? `/api/streams?${query}` : "/api/streams";
    return this.request<ListStreamsResponse>("GET", path);
  }

  async get(id: string): Promise<StreamResponse> {
    return this.requestWithStreamId("GET", (id) => `/api/streams/${id}`, id);
  }

  async delete(id: string): Promise<void> {
    return this.requestWithStreamId("DELETE", (id) => `/api/streams/${id}`, id);
  }

  async enable(id: string): Promise<StreamResponse> {
    return this.requestWithStreamId("POST", (id) => `/api/streams/${id}/enable`, id);
  }

  async disable(id: string): Promise<StreamResponse> {
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
}
