import type {
  ViewSummary,
  ViewDetail,
  ViewQueryParams,
  ReindexResponse,
} from "@secondlayer/shared/schemas";
import type { DeployViewRequest, DeployViewResponse } from "@secondlayer/shared/schemas/views";
import { BaseClient } from "../base.ts";

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

export class Views extends BaseClient {
  async list(): Promise<{ data: ViewSummary[] }> {
    return this.request<{ data: ViewSummary[] }>("GET", "/api/views");
  }

  async get(name: string): Promise<ViewDetail> {
    return this.request<ViewDetail>("GET", `/api/views/${name}`);
  }

  async reindex(name: string, options?: { fromBlock?: number; toBlock?: number }): Promise<ReindexResponse> {
    return this.request<ReindexResponse>("POST", `/api/views/${name}/reindex`, options);
  }

  async delete(name: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("DELETE", `/api/views/${name}`);
  }

  async deploy(data: DeployViewRequest): Promise<DeployViewResponse> {
    return this.request<DeployViewResponse>("POST", "/api/views", data);
  }

  async queryTable(name: string, table: string, params: ViewQueryParams = {}): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/api/views/${name}/${table}${buildViewQueryString(params)}`);
  }

  async queryTableCount(name: string, table: string, params: ViewQueryParams = {}): Promise<{ count: number }> {
    return this.request<{ count: number }>("GET", `/api/views/${name}/${table}/count${buildViewQueryString(params)}`);
  }
}
