import type {
	ReindexResponse,
	SubgraphDetail,
	SubgraphGapsResponse,
	SubgraphQueryParams,
	SubgraphSummary,
} from "@secondlayer/shared/schemas";
import type {
	DeploySubgraphRequest,
	DeploySubgraphResponse,
} from "@secondlayer/shared/schemas/subgraphs";
import type {
	FindManyOptions,
	InferSubgraphClient,
	WhereInput,
} from "@secondlayer/subgraphs";
import { BaseClient } from "../base.ts";
import { resolveOrderByColumn, serializeWhere } from "./serialize.ts";

export interface SubgraphSource {
	name: string;
	version: string;
	sourceCode: string | null;
	readOnly: boolean;
	reason?: string;
	updatedAt: string;
}

export interface BundleSubgraphResponse {
	ok: true;
	name: string;
	version: string | null;
	description: string | null;
	sources: Record<string, Record<string, unknown>>;
	schema: Record<string, unknown>;
	handlerCode: string;
	sourceCode: string;
	bundleSize: number;
}

function buildSubgraphQueryString(params: SubgraphQueryParams): string {
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

export class Subgraphs extends BaseClient {
	async list(): Promise<{ data: SubgraphSummary[] }> {
		return this.request<{ data: SubgraphSummary[] }>("GET", "/api/subgraphs");
	}

	async get(name: string): Promise<SubgraphDetail> {
		return this.request<SubgraphDetail>("GET", `/api/subgraphs/${name}`);
	}

	async reindex(
		name: string,
		options?: { fromBlock?: number; toBlock?: number },
	): Promise<ReindexResponse> {
		return this.request<ReindexResponse>(
			"POST",
			`/api/subgraphs/${name}/reindex`,
			options,
		);
	}

	async stop(
		name: string,
	): Promise<{ message: string; operationId?: string; status?: string }> {
		return this.request<{
			message: string;
			operationId?: string;
			status?: string;
		}>("POST", `/api/subgraphs/${name}/stop`);
	}

	async backfill(
		name: string,
		options: { fromBlock: number; toBlock: number },
	): Promise<ReindexResponse> {
		return this.request<ReindexResponse>(
			"POST",
			`/api/subgraphs/${name}/backfill`,
			options,
		);
	}

	async gaps(
		name: string,
		opts?: { limit?: number; offset?: number; resolved?: boolean },
	): Promise<SubgraphGapsResponse> {
		const qs = new URLSearchParams();
		if (opts?.limit !== undefined) qs.set("_limit", String(opts.limit));
		if (opts?.offset !== undefined) qs.set("_offset", String(opts.offset));
		if (opts?.resolved !== undefined) qs.set("resolved", String(opts.resolved));
		const query = qs.toString();
		return this.request<SubgraphGapsResponse>(
			"GET",
			`/api/subgraphs/${name}/gaps${query ? `?${query}` : ""}`,
		);
	}

	async delete(name: string): Promise<{ message: string }> {
		return this.request<{ message: string }>(
			"DELETE",
			`/api/subgraphs/${name}`,
		);
	}

	async deploy(data: DeploySubgraphRequest): Promise<DeploySubgraphResponse> {
		return this.request<DeploySubgraphResponse>("POST", "/api/subgraphs", data);
	}

	async getSource(name: string): Promise<SubgraphSource> {
		return this.request<SubgraphSource>("GET", `/api/subgraphs/${name}/source`);
	}

	/**
	 * Bundle a TypeScript subgraph source on the server. Used by the web chat
	 * authoring loop so Vercel's serverless runtime doesn't have to run esbuild.
	 */
	async bundle(data: { code: string }): Promise<BundleSubgraphResponse> {
		return this.request<BundleSubgraphResponse>(
			"POST",
			"/api/subgraphs/bundle",
			data,
		);
	}

	async queryTable(
		name: string,
		table: string,
		params: SubgraphQueryParams = {},
	): Promise<unknown[]> {
		const result = await this.request<{ data: unknown[] } | unknown[]>(
			"GET",
			`/api/subgraphs/${name}/${table}${buildSubgraphQueryString(params)}`,
		);
		return Array.isArray(result) ? result : result.data;
	}

	async queryTableCount(
		name: string,
		table: string,
		params: SubgraphQueryParams = {},
	): Promise<{ count: number }> {
		return this.request<{ count: number }>(
			"GET",
			`/api/subgraphs/${name}/${table}/count${buildSubgraphQueryString(params)}`,
		);
	}

	/**
	 * Returns a typed client for a subgraph defined with `defineSubgraph()`.
	 * Row types are inferred from the subgraph's schema literal types.
	 *
	 * @example
	 * ```ts
	 * import mySubgraph from './subgraphs/my-token-subgraph'
	 * const client = sl.subgraphs.typed(mySubgraph)
	 * const rows = await client.transfers.findMany({ where: { sender: 'SP...' } })
	 * // rows: InferTableRow<typeof mySubgraph.schema.transfers>[]
	 * ```
	 */
	typed<T extends { name: string; schema: Record<string, unknown> }>(
		def: T,
	): InferSubgraphClient<T> {
		const result: Record<string, unknown> = {};

		for (const tableName of Object.keys(def.schema)) {
			result[tableName] = this.createTableClient(def.name, tableName);
		}

		return result as InferSubgraphClient<T>;
	}

	private createTableClient(subgraphName: string, tableName: string) {
		const self = this;

		return {
			async findMany<TRow>(
				options: FindManyOptions<TRow> = {},
			): Promise<TRow[]> {
				const filters = options.where
					? serializeWhere(options.where as Record<string, unknown>)
					: undefined;

				let sort: string | undefined;
				let order: string | undefined;
				if (options.orderBy) {
					const entries = Object.entries(options.orderBy) as [
						string,
						"asc" | "desc",
					][];
					if (entries.length > 0) {
						if (entries.length > 1) {
							const extra = entries
								.slice(1)
								.map(([col]) => col)
								.join(", ");
							throw new Error(
								`orderBy supports only one column; remove extra keys: ${extra}`,
							);
						}
						const [col, dir] = entries[0]!;
						sort = resolveOrderByColumn(col);
						order = dir ?? "asc";
					}
				}

				const params: SubgraphQueryParams = {
					sort,
					order,
					limit: options.limit,
					offset: options.offset,
					fields: options.fields?.join(","),
					filters,
				};

				return self.queryTable(subgraphName, tableName, params) as Promise<
					TRow[]
				>;
			},

			async count<TRow>(where?: WhereInput<TRow>): Promise<number> {
				const filters = where
					? serializeWhere(where as Record<string, unknown>)
					: undefined;

				const result = await self.queryTableCount(subgraphName, tableName, {
					filters,
				});
				return result.count;
			},
		};
	}
}
