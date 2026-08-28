import type { SubgraphSummary } from "@secondlayer/shared/schemas";
import { BaseClient } from "./base.ts";
import type { SecondLayerOptions } from "./base.ts";
import { Contracts } from "./contracts/client.ts";
import { ApiError, SecondLayerError } from "./errors.ts";
import { Index } from "./index-api/client.ts";
import type { IndexTip } from "./index-api/client.ts";
import { createStreamsClient } from "./streams/client.ts";
import type { StreamsClient, StreamsTip } from "./streams/types.ts";
import { Subgraphs } from "./subgraphs/client.ts";
import type { SubgraphOperationStatus } from "./subgraphs/client.ts";
import { Subscriptions } from "./subscriptions/client.ts";

export interface ContextAccount {
	email: string;
}

export interface ActiveSubgraphOperation {
	subgraph: string;
	operationId: string;
	kind: SubgraphOperationStatus["kind"];
	status: SubgraphOperationStatus["status"];
	progress: number | null;
}

/** Why one snapshot field could not be read. Serialized from the SDK error
 *  family so a snapshot stays plain data. */
export interface ContextFieldError {
	message: string;
	/** Stable code from the API envelope (`UNAUTHORIZED`, `INDEX_NOT_READY`)
	 *  or the SDK (`REQUEST_TIMEOUT`); absent for a bare transport failure. */
	code?: string;
	/** HTTP status; `0` when the API could not be reached. */
	status?: number;
	/** Whether the same read can succeed on a retry (429, 5xx, network). */
	retryable: boolean;
}

/** One snapshot field: the value, or `null` plus the error that produced it.
 *  `value: null` with no `error` means the read succeeded and found nothing. */
export interface ContextField<T> {
	value: T | null;
	error?: ContextFieldError;
}

/**
 * A point-in-time orientation snapshot for an agent: the live tips and what
 * this instance holds. Every field is a {@link ContextField}, so a missing
 * value says why it is missing (API unreachable, token rejected, index still
 * catching up) instead of a bare `null`. `context()` itself never throws.
 */
export interface ContextSnapshot {
	/** Token identity from `/api/accounts/me`. A self-hosted instance has no
	 *  account system: the read 404s and the field carries that error. */
	account: ContextField<ContextAccount>;
	streamsTip: ContextField<StreamsTip>;
	indexTip: ContextField<IndexTip>;
	subgraphs: ContextField<SubgraphSummary[]>;
	subscriptions: ContextField<{
		count: number;
		byStatus: Record<string, number>;
	}>;
	/** In-flight reindex operations (bounded to subgraphs reporting `reindexing`). */
	activeOperations: ContextField<ActiveSubgraphOperation[]>;
}

/** Fold one read into a {@link ContextField}: the value, or `null` with the
 *  failure described. Exported for callers that assemble their own snapshot
 *  from extra reads and want the same shape. */
export async function contextField<T>(
	read: Promise<T>,
): Promise<ContextField<T>> {
	try {
		return { value: await read };
	} catch (err) {
		return { value: null, error: describeContextError(err) };
	}
}

function describeContextError(err: unknown): ContextFieldError {
	if (err instanceof SecondLayerError) {
		return {
			message: err.shortMessage,
			...(err.code !== undefined ? { code: err.code } : {}),
			...(err instanceof ApiError ? { status: err.status } : {}),
			retryable: err.retryable,
		};
	}
	// A bare TypeError is fetch's own network failure (Streams reads are not
	// wrapped): unreachable, and worth another try, same as the consume loops.
	if (err instanceof TypeError) {
		return { message: err.message, status: 0, retryable: true };
	}
	return {
		message: err instanceof Error ? err.message : String(err),
		retryable: false,
	};
}

export class SecondLayer extends BaseClient {
	readonly streams: StreamsClient;
	readonly index: Index;
	readonly contracts: Contracts;
	readonly subgraphs: Subgraphs;
	readonly subscriptions: Subscriptions;

	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
		this.streams = createStreamsClient({
			// Already resolved by BaseClient (an explicit "" stays keyless), so the
			// env precedence runs, and warns, once per client.
			apiKey: this.apiKey,
			origin: this.origin,
			baseUrl: options.baseUrl,
			fetchImpl: options.fetchImpl,
			dumpsBaseUrl: options.dumpsBaseUrl,
			verify: options.verify,
			verifyDumpsManifest: options.verifyDumpsManifest,
		});
		this.index = new Index(options);
		this.contracts = new Contracts(options);
		this.subgraphs = new Subgraphs(options);
		this.subscriptions = new Subscriptions(options);
	}

	/**
	 * Up to 10 public reads in one round trip (`POST /v1/batch`). Each item
	 * is authorized on its own; the client's bearer token applies to every item.
	 */
	async batch(
		requests: Array<{
			path: string;
			params?: Record<string, string | number | boolean>;
		}>,
	): Promise<{
		results: Array<{ path: string | null; status: number; body: unknown }>;
	}> {
		return this.request("POST", "/v1/batch", { requests });
	}

	/**
	 * Assemble a {@link ContextSnapshot}: the same orientation an MCP agent
	 * reads from `secondlayer://context`, available to any SDK/CLI consumer.
	 * Reads run concurrently; a failed read lands as `{ value: null, error }`
	 * on its field rather than rejecting the whole snapshot.
	 */
	async context(): Promise<ContextSnapshot> {
		const [account, streamsTip, indexEnv, subgraphsRes, subscriptionsRes] =
			await Promise.all([
				contextField(this.request<ContextAccount>("GET", "/api/accounts/me")),
				contextField(this.streams.tip()),
				contextField(this.index.canonical.list({ limit: 1 })),
				contextField(this.subgraphs.list()),
				contextField(this.subscriptions.list()),
			]);

		const subgraphs: ContextField<SubgraphSummary[]> = {
			value: subgraphsRes.value?.data ?? null,
			...(subgraphsRes.error ? { error: subgraphsRes.error } : {}),
		};

		const subscriptions: ContextSnapshot["subscriptions"] = {
			value: null,
			...(subscriptionsRes.error ? { error: subscriptionsRes.error } : {}),
		};
		if (subscriptionsRes.value) {
			const byStatus: Record<string, number> = {};
			for (const s of subscriptionsRes.value.data) {
				byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
			}
			subscriptions.value = {
				count: subscriptionsRes.value.data.length,
				byStatus,
			};
		}

		// In-flight ops: only probe subgraphs that report `reindexing`, so this
		// stays cheap (usually zero extra calls) instead of N+1 over every subgraph.
		let activeOperations: ContextField<ActiveSubgraphOperation[]> = {
			value: null,
			error: {
				message:
					"Not probed: in-flight operations are read per subgraph, and the subgraph list did not resolve.",
				retryable: subgraphs.error?.retryable ?? false,
			},
		};
		if (subgraphs.value) {
			const probed = await Promise.all(
				subgraphs.value
					.filter((s) => s.status === "reindexing")
					.map(async (s) => {
						const res = await contextField(this.subgraphs.operations(s.name));
						const op = res.value?.operations.find(
							(o) => o.status === "queued" || o.status === "running",
						);
						return op
							? {
									subgraph: s.name,
									operationId: op.id,
									kind: op.kind,
									status: op.status,
									progress: op.progress,
								}
							: null;
					}),
			);
			activeOperations = {
				value: probed.filter((o): o is ActiveSubgraphOperation => o !== null),
			};
		}

		return {
			account,
			streamsTip,
			indexTip: {
				value: indexEnv.value?.tip ?? null,
				...(indexEnv.error ? { error: indexEnv.error } : {}),
			},
			subgraphs,
			subscriptions,
			activeOperations,
		};
	}
}
