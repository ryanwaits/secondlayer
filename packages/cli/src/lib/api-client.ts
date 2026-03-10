import { SecondLayer } from "@secondlayer/sdk";
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

import { ApiError } from "@secondlayer/sdk";
export { ApiError };
export type { ViewQueryParams } from "@secondlayer/shared/schemas";

/**
 * Guard that throws if the response is not ok, extracting the best error message.
 */
export async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  const body = await res.text();
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.error === "string" && parsed.error) throw new Error(parsed.error);
  } catch (e) {
    if (e instanceof Error && e.message !== body) throw e;
  }
  throw new Error(`HTTP ${res.status}`);
}

/**
 * Shared error handler for API calls. Prints auth hint on 401, generic message otherwise.
 */
export function handleApiError(err: unknown, action: string): never {
  if (err instanceof ApiError && (err as { status: number }).status === 401) {
    console.error("Error: Authentication required. Run: sl auth login");
    process.exit(1);
  }
  console.error(`Error: Failed to ${action}: ${err}`);
  process.exit(1);
}

async function getClient(): Promise<SecondLayer> {
  const config = await loadConfig();
  const baseUrl = resolveApiUrl(config);
  return new SecondLayer({ baseUrl, apiKey: config.sessionToken ?? config.apiKey });
}

/**
 * Build auth headers from config. Use for raw fetch() calls outside the SDK.
 */
export function authHeaders(config: { sessionToken?: string; apiKey?: string }): Record<string, string> {
  return SecondLayer.authHeaders(config.sessionToken ?? config.apiKey);
}

// ── Streams ───────────────────────────────────────────────────────────────

export async function createStream(data: CreateStream): Promise<CreateStreamResponse> {
  return (await getClient()).streams.create(data);
}

export async function updateStream(id: string, data: UpdateStream): Promise<StreamResponse> {
  return (await getClient()).streams.update(id, data);
}

export async function updateStreamByName(name: string, data: CreateStream): Promise<StreamResponse> {
  return (await getClient()).streams.updateByName(name, data);
}

export async function listStreams(params?: { status?: string }): Promise<ListStreamsResponse> {
  return (await getClient()).streams.list(params);
}

export async function resolveStreamId(partialId: string): Promise<string> {
  return (await getClient()).streams.resolveStreamId(partialId);
}

export async function getStream(id: string): Promise<StreamResponse> {
  return (await getClient()).streams.get(id);
}

export async function deleteStream(id: string): Promise<void> {
  return (await getClient()).streams.delete(id);
}

export async function enableStream(id: string): Promise<StreamResponse> {
  return (await getClient()).streams.enable(id);
}

export async function disableStream(id: string): Promise<StreamResponse> {
  return (await getClient()).streams.disable(id);
}

export async function rotateSecret(id: string): Promise<{ secret: string }> {
  return (await getClient()).streams.rotateSecret(id);
}

export async function pauseAllStreams(): Promise<BulkPauseResponse> {
  return (await getClient()).streams.pauseAll();
}

export async function resumeAllStreams(): Promise<BulkResumeResponse> {
  return (await getClient()).streams.resumeAll();
}

export async function getQueueStats(): Promise<QueueStats> {
  return (await getClient()).getQueueStats();
}

// ── Views ─────────────────────────────────────────────────────────────────

export async function listViewsApi(): Promise<{ data: ViewSummary[] }> {
  return (await getClient()).views.list();
}

export async function getViewApi(name: string): Promise<ViewDetail> {
  return (await getClient()).views.get(name);
}

export async function reindexViewApi(name: string, options?: { fromBlock?: number; toBlock?: number }): Promise<ReindexResponse> {
  return (await getClient()).views.reindex(name, options);
}

export async function deleteViewApi(name: string): Promise<{ message: string }> {
  return (await getClient()).views.delete(name);
}

export async function deployViewApi(data: DeployViewRequest): Promise<DeployViewResponse> {
  return (await getClient()).views.deploy(data);
}

export async function queryViewTable(name: string, table: string, params: ViewQueryParams = {}): Promise<unknown[]> {
  return (await getClient()).views.queryTable(name, table, params);
}

export async function queryViewTableCount(name: string, table: string, params: ViewQueryParams = {}): Promise<{ count: number }> {
  return (await getClient()).views.queryTableCount(name, table, params);
}

