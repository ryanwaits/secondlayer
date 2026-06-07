import type { SubgraphSummary } from "@secondlayer/shared/schemas";
import { ApiKeys } from "./api-keys/client.ts";
import { BaseClient } from "./base.ts";
import type { SecondLayerOptions } from "./base.ts";
import { Contracts } from "./contracts/client.ts";
import { Datasets } from "./datasets/client.ts";
import { Index } from "./index-api/client.ts";
import type { IndexTip } from "./index-api/client.ts";
import { Projects } from "./projects/client.ts";
import { createStreamsClient } from "./streams/client.ts";
import type { StreamsClient, StreamsTip } from "./streams/types.ts";
import { Subgraphs } from "./subgraphs/client.ts";
import type { SubgraphOperationStatus } from "./subgraphs/client.ts";
import { Subscriptions } from "./subscriptions/client.ts";

export interface ContextAccount {
	email: string;
	plan: string;
}

export interface ActiveSubgraphOperation {
	subgraph: string;
	operationId: string;
	kind: SubgraphOperationStatus["kind"];
	status: SubgraphOperationStatus["status"];
	progress: number | null;
}

/**
 * A point-in-time orientation snapshot for an agent: who you are, the live tips,
 * and what you own. Each field is `null` when it couldn't be read (e.g. no key,
 * or a free-tier key for a Build+ surface) so the snapshot never throws.
 */
export interface ContextSnapshot {
	account: ContextAccount | null;
	streamsTip: StreamsTip | null;
	indexTip: IndexTip | null;
	subgraphs: SubgraphSummary[] | null;
	subscriptions: { count: number; byStatus: Record<string, number> } | null;
	/** In-flight reindex operations (bounded to subgraphs reporting `reindexing`). */
	activeOperations: ActiveSubgraphOperation[] | null;
}

export class SecondLayer extends BaseClient {
	readonly streams: StreamsClient;
	readonly index: Index;
	readonly datasets: Datasets;
	readonly contracts: Contracts;
	readonly subgraphs: Subgraphs;
	readonly subscriptions: Subscriptions;
	readonly apiKeys: ApiKeys;
	readonly projects: Projects;

	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
		this.streams = createStreamsClient({
			apiKey: options.apiKey ?? "",
			baseUrl: options.baseUrl,
			fetchImpl: options.fetchImpl,
		});
		this.index = new Index(options);
		this.datasets = new Datasets(options);
		this.contracts = new Contracts(options);
		this.subgraphs = new Subgraphs(options);
		this.subscriptions = new Subscriptions(options);
		this.apiKeys = new ApiKeys(options);
		this.projects = new Projects(options);
	}

	/**
	 * Assemble a {@link ContextSnapshot} — the same orientation an MCP agent reads
	 * from `secondlayer://context`, but available to any SDK/CLI consumer. Reads
	 * run concurrently and degrade to `null` per field on failure.
	 */
	async context(): Promise<ContextSnapshot> {
		const safe = <T>(p: Promise<T>): Promise<T | null> =>
			p.then((v) => v).catch(() => null);

		const [account, streamsTip, indexEnv, subgraphsRes, subscriptionsRes] =
			await Promise.all([
				safe(this.request<ContextAccount>("GET", "/api/accounts/me")),
				safe(this.streams.tip()),
				safe(this.index.canonical.list({ limit: 1 })),
				safe(this.subgraphs.list()),
				safe(this.subscriptions.list()),
			]);

		const subgraphs = subgraphsRes?.data ?? null;

		let subscriptions: ContextSnapshot["subscriptions"] = null;
		if (subscriptionsRes) {
			const byStatus: Record<string, number> = {};
			for (const s of subscriptionsRes.data) {
				byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
			}
			subscriptions = { count: subscriptionsRes.data.length, byStatus };
		}

		// In-flight ops: only probe subgraphs that report `reindexing`, so this
		// stays cheap (usually zero extra calls) instead of N+1 over every subgraph.
		let activeOperations: ActiveSubgraphOperation[] | null = null;
		if (subgraphs) {
			const probed = await Promise.all(
				subgraphs
					.filter((s) => s.status === "reindexing")
					.map(async (s) => {
						const res = await safe(this.subgraphs.operations(s.name));
						const op = res?.operations.find(
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
			activeOperations = probed.filter(
				(o): o is ActiveSubgraphOperation => o !== null,
			);
		}

		return {
			account,
			streamsTip,
			indexTip: indexEnv?.tip ?? null,
			subgraphs,
			subscriptions,
			activeOperations,
		};
	}
}
