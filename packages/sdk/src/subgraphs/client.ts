import type {
	ReindexResponse,
	SubgraphAggregateParams,
	SubgraphAggregateResponse,
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
	SubgraphAgentSchema,
	SubgraphSpecOptions,
} from "@secondlayer/shared/subgraphs/spec";
import type {
	AggregateResult,
	AggregateSpec,
	FindManyOptions,
	InferSubgraphClient,
	SubscribeOptions,
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

/** Status of a tracked reindex/backfill operation (poll until terminal). */
export interface SubgraphOperationStatus {
	id: string;
	subgraphName: string;
	kind: "reindex" | "backfill";
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	fromBlock: number | null;
	toBlock: number | null;
	processedBlocks: number | null;
	/** 0–1 fraction; null when no denominator is known yet. 1 when completed. */
	progress: number | null;
	error: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

/** /v1 cursor envelope for subgraph table reads. */
export interface SubgraphRowsEnvelope<T = unknown> {
	rows: T[];
	next_cursor: string | null;
	tip: {
		block_height: number;
		subgraph_height: number;
		blocks_behind: number;
	};
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

function buildAggregateQueryString(params: SubgraphAggregateParams): string {
	const qs = new URLSearchParams();
	if (params.filters) {
		for (const [key, value] of Object.entries(params.filters)) {
			qs.set(key, String(value));
		}
	}
	if (params.count) qs.set("_count", "true");
	if (params.countDistinct?.length)
		qs.set("_countDistinct", params.countDistinct.join(","));
	if (params.sum?.length) qs.set("_sum", params.sum.join(","));
	if (params.min?.length) qs.set("_min", params.min.join(","));
	if (params.max?.length) qs.set("_max", params.max.join(","));
	const str = qs.toString();
	return str ? `?${str}` : "";
}

function buildSpecQueryString(options?: SubgraphSpecOptions): string {
	const qs = new URLSearchParams();
	if (options?.serverUrl) qs.set("server", options.serverUrl);
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

	async openapi(
		name: string,
		options?: SubgraphSpecOptions,
	): Promise<Record<string, unknown>> {
		return this.request<Record<string, unknown>>(
			"GET",
			`/api/subgraphs/${name}/openapi.json${buildSpecQueryString(options)}`,
		);
	}

	async schema(
		name: string,
		options?: SubgraphSpecOptions,
	): Promise<SubgraphAgentSchema> {
		return this.request<SubgraphAgentSchema>(
			"GET",
			`/api/subgraphs/${name}/schema.json${buildSpecQueryString(options)}`,
		);
	}

	async markdown(name: string, options?: SubgraphSpecOptions): Promise<string> {
		return this.requestText(
			"GET",
			`/api/subgraphs/${name}/docs.md${buildSpecQueryString(options)}`,
		);
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

	async delete(
		name: string,
		options?: { force?: boolean },
	): Promise<{ message: string }> {
		const qs = options?.force ? "?force=true" : "";
		return this.request<{ message: string }>(
			"DELETE",
			`/api/subgraphs/${name}${qs}`,
		);
	}

	/**
	 * Publish: claim the name in the global public namespace and open anon
	 * reads on /v1/subgraphs/:name. 409 PUBLIC_NAME_TAKEN if another account
	 * holds the public name.
	 */
	async publish(
		name: string,
	): Promise<{ name: string; visibility: "public"; url: string }> {
		return this.request<{ name: string; visibility: "public"; url: string }>(
			"POST",
			`/api/subgraphs/${name}/publish`,
		);
	}

	/** Make reads private again (owning account's bearer key required). */
	async unpublish(
		name: string,
	): Promise<{ name: string; visibility: "private" }> {
		return this.request<{ name: string; visibility: "private" }>(
			"POST",
			`/api/subgraphs/${name}/unpublish`,
		);
	}

	/**
	 * Open /v1 read: cursor-paginated rows. Anon works for public subgraphs;
	 * pass an apiKey on the client for private ones. Resume with the returned
	 * `next_cursor`.
	 */
	async rows<T = unknown>(
		name: string,
		table: string,
		params: Omit<SubgraphQueryParams, "offset" | "sort"> & {
			cursor?: string;
		} = {},
	): Promise<SubgraphRowsEnvelope<T>> {
		const { cursor, ...rest } = params;
		const qs = buildSubgraphQueryString(rest);
		const sep = qs ? "&" : "?";
		const cursorQs = cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : "";
		return this.request<SubgraphRowsEnvelope<T>>(
			"GET",
			`/v1/subgraphs/${name}/${table}${qs}${cursorQs}`,
		);
	}

	/** Recent reindex/backfill operations for a subgraph, newest first. */
	async operations(
		name: string,
	): Promise<{ operations: SubgraphOperationStatus[] }> {
		return this.request<{ operations: SubgraphOperationStatus[] }>(
			"GET",
			`/api/subgraphs/${name}/operations`,
		);
	}

	/** Status of a single operation (poll the `operationId` returned by
	 *  reindex/backfill/stop until `status` is terminal). */
	async getOperation(
		name: string,
		operationId: string,
	): Promise<SubgraphOperationStatus> {
		return this.request<SubgraphOperationStatus>(
			"GET",
			`/api/subgraphs/${name}/operations/${operationId}`,
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

	async queryTableAggregate(
		name: string,
		table: string,
		params: SubgraphAggregateParams = {},
	): Promise<SubgraphAggregateResponse> {
		return this.request<SubgraphAggregateResponse>(
			"GET",
			`/api/subgraphs/${name}/${table}/aggregate${buildAggregateQueryString(params)}`,
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
					// Accept the object form `{ col: "asc" }` or the ordered array
					// form `[[col, "asc"], …]` for deterministic multi-column sort.
					const entries: [string, "asc" | "desc"][] = Array.isArray(
						options.orderBy,
					)
						? (options.orderBy as [string, "asc" | "desc"][])
						: (Object.entries(options.orderBy) as [string, "asc" | "desc"][]);
					if (entries.length > 0) {
						// Comma-joined parallel lists → `_sort=a,b&_order=asc,desc`.
						sort = entries.map(([col]) => resolveOrderByColumn(col)).join(",");
						order = entries.map(([, dir]) => dir ?? "asc").join(",");
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

			async aggregate<TRow, const A extends AggregateSpec<TRow>>(
				spec: A,
			): Promise<AggregateResult<TRow, A>> {
				const filters = spec.where
					? serializeWhere(spec.where as Record<string, unknown>)
					: undefined;

				const result = await self.queryTableAggregate(subgraphName, tableName, {
					filters,
					count: spec.count,
					countDistinct: spec.countDistinct,
					sum: spec.sum,
					min: spec.min,
					max: spec.max,
				});
				return result as AggregateResult<TRow, A>;
			},

			subscribe<TRow>(
				onRow: (row: TRow) => void,
				options: SubscribeOptions<TRow> = {},
			): () => void {
				const filters = options.where
					? serializeWhere(options.where as Record<string, unknown>)
					: {};
				const qs = new URLSearchParams();
				for (const [k, v] of Object.entries(filters)) qs.set(k, String(v));
				if (options.since != null) qs.set("since", String(options.since));
				const query = qs.toString();
				const url = `${self.baseUrl}/api/subgraphs/${subgraphName}/${tableName}/stream${query ? `?${query}` : ""}`;

				type EventSourceLike = {
					onmessage: ((ev: { data: string }) => void) | null;
					onerror: ((ev: unknown) => void) | null;
					close(): void;
				};
				const ES = (
					globalThis as unknown as {
						EventSource?: new (url: string) => EventSourceLike;
					}
				).EventSource;
				if (!ES) {
					throw new Error(
						"subscribe() needs a global EventSource (available in browsers and Node >= 22).",
					);
				}
				const es = new ES(url);
				es.onmessage = (ev) => {
					try {
						onRow(JSON.parse(ev.data) as TRow);
					} catch {
						// ignore non-JSON frames (e.g. heartbeats)
					}
				};
				if (options.onError) {
					const handler = options.onError;
					es.onerror = (ev) => handler(ev);
				}
				return () => es.close();
			},
		};
	}
}
