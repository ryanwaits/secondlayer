import { StreamsClient } from "@secondlayer/sdk";
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
import { loadConfig, resolveApiUrl } from "./config.ts";

export { ApiError } from "@secondlayer/sdk";
export type { ViewQueryParams } from "@secondlayer/shared/schemas";

async function getClient(): Promise<StreamsClient> {
  const config = await loadConfig();
  const baseUrl = resolveApiUrl(config);
  return new StreamsClient({ baseUrl, apiKey: config.sessionToken ?? config.apiKey });
}

/**
 * Build auth headers from config. Use for raw fetch() calls outside the SDK.
 */
export function authHeaders(config: { sessionToken?: string; apiKey?: string }): Record<string, string> {
  return StreamsClient.authHeaders(config.sessionToken ?? config.apiKey);
}

// ── Streams ───────────────────────────────────────────────────────────────

export async function createStream(data: CreateStream): Promise<CreateStreamResponse> {
  return (await getClient()).createStream(data);
}

export async function updateStream(id: string, data: UpdateStream): Promise<StreamResponse> {
  return (await getClient()).updateStream(id, data);
}

export async function updateStreamByName(name: string, data: CreateStream): Promise<StreamResponse> {
  return (await getClient()).updateStreamByName(name, data);
}

export async function listStreams(params?: { status?: string }): Promise<ListStreamsResponse> {
  return (await getClient()).listStreams(params);
}

export async function resolveStreamId(partialId: string): Promise<string> {
  return (await getClient()).resolveStreamId(partialId);
}

export async function getStream(id: string): Promise<StreamResponse> {
  return (await getClient()).getStream(id);
}

export async function deleteStream(id: string): Promise<void> {
  return (await getClient()).deleteStream(id);
}

export async function enableStream(id: string): Promise<StreamResponse> {
  return (await getClient()).enableStream(id);
}

export async function disableStream(id: string): Promise<StreamResponse> {
  return (await getClient()).disableStream(id);
}

export async function rotateSecret(id: string): Promise<{ secret: string }> {
  return (await getClient()).rotateSecret(id);
}

export async function pauseAllStreams(): Promise<BulkPauseResponse> {
  return (await getClient()).pauseAll();
}

export async function resumeAllStreams(): Promise<BulkResumeResponse> {
  return (await getClient()).resumeAll();
}

export async function getQueueStats(): Promise<QueueStats> {
  return (await getClient()).getQueueStats();
}

// ── Views ─────────────────────────────────────────────────────────────────

export async function listViewsApi(): Promise<{ data: ViewSummary[] }> {
  return (await getClient()).listViews();
}

export async function getViewApi(name: string): Promise<ViewDetail> {
  return (await getClient()).getView(name);
}

export async function reindexViewApi(name: string, options?: { fromBlock?: number; toBlock?: number }): Promise<ReindexResponse> {
  return (await getClient()).reindexView(name, options);
}

export async function deleteViewApi(name: string): Promise<{ message: string }> {
  return (await getClient()).deleteView(name);
}

export async function deployViewApi(data: DeployViewRequest): Promise<DeployViewResponse> {
  return (await getClient()).deployView(data);
}

export async function queryViewTable(name: string, table: string, params: ViewQueryParams = {}): Promise<unknown[]> {
  return (await getClient()).queryTable(name, table, params);
}

export async function queryViewTableCount(name: string, table: string, params: ViewQueryParams = {}): Promise<{ count: number }> {
  return (await getClient()).queryTableCount(name, table, params);
}
