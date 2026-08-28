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
import { BaseClient, buildQuery, seg } from "../base.ts";
import { readSse } from "../streams/subscribe.ts";
import {
	type DeclaredColumns,
	resolveOrderByColumn,
	serializeWhere,
} from "./serialize.ts";

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

const SUBSCRIBE_RECONNECT_DELAY_MS = 1000;

/** Column names a `defineSubgraph()` table declares, or undefined when the
 *  schema entry is not in the `{ columns: {...} }` shape. */
function declaredColumns(table: unknown): DeclaredColumns | undefined {
	if (!table || typeof table !== "object") return undefined;
	const columns = (table as { columns?: unknown }).columns;
	if (!columns || typeof columns !== "object") return undefined;
	return new Set(Object.keys(columns));
}

/** Block height of a streamed row. The server writes rows in their wire
 *  shape (`_block_height`, bigint columns as strings); a caller-shaped row
 *  may carry `_blockHeight`. Either form advances the reconnect cursor. */
function rowBlockHeight(row: unknown): number | undefined {
	const r = row as { _block_height?: unknown; _blockHeight?: unknown };
	const raw = r._block_height ?? r._blockHeight;
	if (typeof raw !== "number" && typeof raw !== "string") return undefined;
	const height = Number(raw);
	return Number.isFinite(height) ? height : undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function buildSubgraphQueryString(params: SubgraphQueryParams): string {
	return buildQuery({
		_sort: params.sort,
		_order: params.order,
		_limit: params.limit,
		_offset: params.offset,
		_fields: params.fields,
		...params.filters,
	});
}

function buildAggregateQueryString(params: SubgraphAggregateParams): string {
	return buildQuery({
		...params.filters,
		_count: params.count ? "true" : undefined, // emit only when truthy
		_countDistinct: params.countDistinct, // empty array → "" → skipped
		_sum: params.sum,
		_min: params.min,
		_max: params.max,
	});
}

function buildSpecQueryString(options?: SubgraphSpecOptions): string {
	return buildQuery({ server: options?.serverUrl });
}

export class Subgraphs extends BaseClient {
	async list(): Promise<{ data: SubgraphSummary[] }> {
		return this.request<{ data: SubgraphSummary[] }>("GET", "/api/subgraphs");
	}

	/**
	 * The subgraph's current state — health, sync position, tables. The verify
	 * step after a deploy, reindex, or backfill: poll it until `sync` catches
	 * the tip.
	 */
	async status(name: string): Promise<SubgraphDetail> {
		return this.request<SubgraphDetail>("GET", `/api/subgraphs/${seg(name)}`);
	}

	async openapi(
		name: string,
		options?: SubgraphSpecOptions,
	): Promise<Record<string, unknown>> {
		return this.request<Record<string, unknown>>(
			"GET",
			`/api/subgraphs/${seg(name)}/openapi.json${buildSpecQueryString(options)}`,
		);
	}

	async schema(
		name: string,
		options?: SubgraphSpecOptions,
	): Promise<SubgraphAgentSchema> {
		return this.request<SubgraphAgentSchema>(
			"GET",
			`/api/subgraphs/${seg(name)}/schema.json${buildSpecQueryString(options)}`,
		);
	}

	async markdown(name: string, options?: SubgraphSpecOptions): Promise<string> {
		return this.requestText(
			"GET",
			`/api/subgraphs/${seg(name)}/docs.md${buildSpecQueryString(options)}`,
		);
	}

	/**
	 * Reindex always drops and rebuilds the whole subgraph, so it takes no
	 * block range; the API rejects one with `REINDEX_RANGE_NOT_SUPPORTED`.
	 * Use {@link backfill} to process a specific range. While a reindex or
	 * backfill is already running the API answers 409 with code
	 * `OPERATION_IN_PROGRESS`; poll {@link operations} until it finishes.
	 */
	async reindex(name: string): Promise<ReindexResponse> {
		return this.request<ReindexResponse>(
			"POST",
			`/api/subgraphs/${seg(name)}/reindex`,
		);
	}

	async stop(
		name: string,
	): Promise<{ message: string; operationId?: string; status?: string }> {
		return this.request<{
			message: string;
			operationId?: string;
			status?: string;
		}>("POST", `/api/subgraphs/${seg(name)}/stop`);
	}

	/** Process one block range. 409 `OPERATION_IN_PROGRESS` while another
	 *  reindex or backfill runs on this subgraph. */
	async backfill(
		name: string,
		options: { fromBlock: number; toBlock: number },
	): Promise<ReindexResponse> {
		return this.request<ReindexResponse>(
			"POST",
			`/api/subgraphs/${seg(name)}/backfill`,
			options,
		);
	}

	async gaps(
		name: string,
		opts?: { limit?: number; offset?: number; resolved?: boolean },
	): Promise<SubgraphGapsResponse> {
		const qs = buildQuery({
			_limit: opts?.limit,
			_offset: opts?.offset,
			resolved: opts?.resolved,
		});
		return this.request<SubgraphGapsResponse>(
			"GET",
			`/api/subgraphs/${seg(name)}/gaps${qs}`,
		);
	}

	async delete(
		name: string,
		options?: { force?: boolean },
	): Promise<{ message: string }> {
		const qs = buildQuery({ force: options?.force ? true : undefined });
		return this.request<{ message: string }>(
			"DELETE",
			`/api/subgraphs/${seg(name)}${qs}`,
		);
	}

	/**
	 * Open /v1 read: cursor-paginated rows. Anon works on an open instance;
	 * pass an apiKey on the client where reads are closed. Resume with the
	 * returned `next_cursor`.
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
			`/v1/subgraphs/${seg(name)}/${seg(table)}${qs}${cursorQs}`,
		);
	}

	/** Recent reindex/backfill operations for a subgraph, newest first. */
	async operations(
		name: string,
	): Promise<{ operations: SubgraphOperationStatus[] }> {
		return this.request<{ operations: SubgraphOperationStatus[] }>(
			"GET",
			`/api/subgraphs/${seg(name)}/operations`,
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
			`/api/subgraphs/${seg(name)}/operations/${seg(operationId)}`,
		);
	}

	/** Create or update a subgraph. A deploy that needs a rebuild queues one;
	 *  if a reindex or backfill is already running the API answers 409 with
	 *  code `OPERATION_IN_PROGRESS` (an `ApiError`, not a dedicated class). */
	async deploy(data: DeploySubgraphRequest): Promise<DeploySubgraphResponse> {
		return this.request<DeploySubgraphResponse>("POST", "/api/subgraphs", data);
	}

	async getSource(name: string): Promise<SubgraphSource> {
		return this.request<SubgraphSource>(
			"GET",
			`/api/subgraphs/${seg(name)}/source`,
		);
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
			`/api/subgraphs/${seg(name)}/${seg(table)}${buildSubgraphQueryString(params)}`,
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
			`/api/subgraphs/${seg(name)}/${seg(table)}/count${buildSubgraphQueryString(params)}`,
		);
	}

	async queryTableAggregate(
		name: string,
		table: string,
		params: SubgraphAggregateParams = {},
	): Promise<SubgraphAggregateResponse> {
		return this.request<SubgraphAggregateResponse>(
			"GET",
			`/api/subgraphs/${seg(name)}/${seg(table)}/aggregate${buildAggregateQueryString(params)}`,
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

		for (const [tableName, table] of Object.entries(def.schema)) {
			result[tableName] = this.createTableClient(
				def.name,
				tableName,
				declaredColumns(table),
			);
		}

		return result as InferSubgraphClient<T>;
	}

	/**
	 * `columns` is the table's declared column set from `defineSubgraph()`.
	 * Filters and orderBy always accept the canonical system names
	 * `_id` / `_blockHeight` / `_txId` / `_createdAt`; the unprefixed
	 * shorthands (`id`, `blockHeight`, ...) mean the system column only when
	 * the table declares no column of that name.
	 */
	private createTableClient(
		subgraphName: string,
		tableName: string,
		columns?: DeclaredColumns,
	) {
		const self = this;

		return {
			async findMany<TRow>(
				options: Omit<FindManyOptions<TRow>, "fields"> & {
					fields?: readonly (keyof TRow & string)[];
				} = {},
			): Promise<TRow[]> {
				const filters = options.where
					? serializeWhere(options.where as Record<string, unknown>, columns)
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
						sort = entries
							.map(([col]) => resolveOrderByColumn(col, columns))
							.join(",");
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
					? serializeWhere(where as Record<string, unknown>, columns)
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
					? serializeWhere(spec.where as Record<string, unknown>, columns)
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

			/**
			 * Tail rows as the subgraph writes them. Reads `/v1`, so it is keyless
			 * on loopback like `rows`; fetch-based SSE, so it carries the client's
			 * bearer token once the API is bound past loopback. Reconnects after a
			 * dropped connection from the last delivered row's block height; rows
			 * at that height can be delivered again, so key durable writes by
			 * `_id`. Frames are unsigned rows in the server's wire shape
			 * (`_block_height`, not `_blockHeight`).
			 */
			subscribe<TRow>(
				onRow: (row: TRow) => void,
				options: SubscribeOptions<TRow> = {},
			): () => void {
				const filters = options.where
					? serializeWhere(options.where as Record<string, unknown>, columns)
					: {};
				const controller = new AbortController();
				let since: number | undefined = options.since ?? undefined;

				const run = async (): Promise<void> => {
					while (!controller.signal.aborted) {
						try {
							const qs = buildQuery({ ...filters, since });
							await readSse({
								url: `${self.baseUrl}/v1/subgraphs/${seg(subgraphName)}/${seg(tableName)}/stream${qs}`,
								headers: {
									...BaseClient.authHeaders(self.apiKey),
									"x-sl-origin": self.origin,
								},
								signal: controller.signal,
								fetchImpl: self.fetchImpl,
								onFrame: (frame) => {
									if (frame.event === "ping" || !frame.data) return;
									let row: TRow;
									try {
										row = JSON.parse(frame.data) as TRow;
									} catch {
										return; // ignore non-JSON frames (e.g. heartbeats)
									}
									const height = rowBlockHeight(row);
									if (height !== undefined) since = height;
									onRow(row);
								},
							});
							// Clean end (server closed the stream): reconnect from `since`
							// after the same pause as an error, so a server that closes at
							// once (proxy timeout, empty 200) cannot spin a hot loop.
							await sleep(SUBSCRIBE_RECONNECT_DELAY_MS, controller.signal);
						} catch (err) {
							if (controller.signal.aborted) return;
							options.onError?.(err);
							await sleep(SUBSCRIBE_RECONNECT_DELAY_MS, controller.signal);
						}
					}
				};
				void run();
				return () => controller.abort();
			},
		};
	}
}
