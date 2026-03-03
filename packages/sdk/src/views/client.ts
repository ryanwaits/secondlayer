import type {
  ViewSummary,
  ViewDetail,
  ViewQueryParams,
  ReindexResponse,
} from "@secondlayer/shared/schemas";
import type { DeployViewRequest, DeployViewResponse } from "@secondlayer/shared/schemas/views";
import type {
  InferViewClient,
  FindManyOptions,
  WhereInput,
} from "@secondlayer/views";
import { BaseClient } from "../base.ts";
import { serializeWhere, resolveOrderByColumn } from "./serialize.ts";

function buildViewQueryString(params: ViewQueryParams): string {
  const qs = new URLSearchParams();
  if (params.sort) qs.set("_sort", params.sort);
  if (params.order) qs.set("_order", params.order);
  if (params.limit !== undefined) qs.set("_limit", String(params.limit));
  if (params.offset !== undefined) qs.set("_offset", String(params.offset));
  if (params.fields) qs.set("_fields", params.fields);
  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      qs.set(key, String(value));
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

  /**
   * Returns a typed client for a view defined with `defineView()`.
   * Row types are inferred from the view's schema literal types.
   *
   * @example
   * ```ts
   * import myView from './views/my-token-view'
   * const client = sl.views.typed(myView)
   * const rows = await client.transfers.findMany({ where: { sender: 'SP...' } })
   * // rows: InferTableRow<typeof myView.schema.transfers>[]
   * ```
   */
  typed<T extends { name: string; schema: Record<string, unknown> }>(
    def: T,
  ): InferViewClient<T> {
    const result: Record<string, unknown> = {};

    for (const tableName of Object.keys(def.schema)) {
      result[tableName] = this.createTableClient(def.name, tableName);
    }

    return result as InferViewClient<T>;
  }

  private createTableClient(viewName: string, tableName: string) {
    const self = this;

    return {
      async findMany<TRow>(options: FindManyOptions<TRow> = {}): Promise<TRow[]> {
        const filters = options.where
          ? serializeWhere(options.where as Record<string, unknown>)
          : undefined;

        let sort: string | undefined;
        let order: string | undefined;
        if (options.orderBy) {
          const entries = Object.entries(options.orderBy);
          if (entries.length > 0) {
            const [col, dir] = entries[0]!;
            sort = resolveOrderByColumn(col);
            order = (dir as unknown as string | undefined) ?? "asc";
          }
        }

        const params: ViewQueryParams = {
          sort,
          order,
          limit: options.limit,
          offset: options.offset,
          fields: options.fields?.join(","),
          filters,
        };

        return self.queryTable(viewName, tableName, params) as Promise<TRow[]>;
      },

      async count<TRow>(where?: WhereInput<TRow>): Promise<number> {
        const filters = where
          ? serializeWhere(where as Record<string, unknown>)
          : undefined;

        const result = await self.queryTableCount(viewName, tableName, { filters });
        return result.count;
      },
    };
  }
}
