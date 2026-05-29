import { BaseClient, type SecondLayerOptions } from "../base.ts";

/**
 * Typed client for the Foundation Datasets REST API (`/v1/datasets/*`).
 *
 * Most datasets are cursor-paginated event lists with a uniform `list`/`walk`
 * surface; a few (bns names/namespaces/resolve, network-health) are
 * offset/single-object/summary and get bespoke methods. Query params are typed
 * per dataset; rows are `DatasetRow` (JSON) in v1 — per-dataset row interfaces
 * are a fast-follow.
 */

/** A dataset row — flat JSON object. Per-dataset interfaces are a follow-up. */
export type DatasetRow = Record<string, unknown>;

/** Filters shared by every cursor-paginated dataset. */
export interface CursorListParams {
	cursor?: string;
	limit?: number;
	fromBlock?: number;
	toBlock?: number;
}

export interface CursorEnvelope {
	rows: DatasetRow[];
	next_cursor: string | null;
	tip?: { block_height: number };
}

export interface CursorWalkParams extends CursorListParams {
	batchSize?: number;
	signal?: AbortSignal;
}

function appendParam(
	params: URLSearchParams,
	name: string,
	value: number | string | null | undefined,
): void {
	if (value === undefined || value === null) return;
	params.set(name, String(value));
}

// Per-dataset filter params (precise — drives CLI flags + autocomplete).
type RangeFilters = CursorListParams;
export type StxTransfersParams = RangeFilters & {
	sender?: string;
	recipient?: string;
};
export type SbtcEventsParams = RangeFilters & {
	topic?: string;
	address?: string;
};
export type SbtcTokenEventsParams = RangeFilters & {
	eventType?: string;
	sender?: string;
	recipient?: string;
};
export type Pox4CallsParams = RangeFilters & {
	functionName?: string;
	stacker?: string;
	delegateTo?: string;
	signerKey?: string;
	rewardCycle?: number;
	/** Any-role: matches caller OR stacker OR delegate_to. */
	address?: string;
};
export type BurnchainRewardsParams = RangeFilters & {
	/** Filter to one Bitcoin reward address. */
	recipient?: string;
};
export type BurnchainRewardSlotsParams = RangeFilters & {
	/** Filter to one reward-set Bitcoin address. */
	holder?: string;
};
export type BnsEventsParams = RangeFilters & {
	topic?: string;
	namespace?: string;
	name?: string;
	owner?: string;
};
export type BnsNamespaceEventsParams = RangeFilters & {
	status?: string;
	namespace?: string;
};
export type BnsMarketplaceEventsParams = RangeFilters & {
	action?: string;
	bnsId?: string;
};

type CursorDataset<P> = {
	list: (params?: P) => Promise<CursorEnvelope>;
	walk: (
		params?: P & { batchSize?: number; signal?: AbortSignal },
	) => AsyncIterable<DatasetRow>;
};

/** snake_case query keys for the camelCase param fields. */
const PARAM_KEYS: Record<string, string> = {
	fromBlock: "from_block",
	toBlock: "to_block",
	functionName: "function_name",
	delegateTo: "delegate_to",
	signerKey: "signer_key",
	rewardCycle: "reward_cycle",
	eventType: "event_type",
	bnsId: "bns_id",
};

/** Cursor-paginated dataset slugs → REST path + envelope row key. */
export const CURSOR_SLUGS: Record<string, { path: string; rowKey: string }> = {
	"stx-transfers": { path: "stx-transfers", rowKey: "events" },
	"sbtc-events": { path: "sbtc/events", rowKey: "events" },
	"sbtc-token-events": { path: "sbtc/token-events", rowKey: "events" },
	"pox-4-calls": { path: "pox-4/calls", rowKey: "calls" },
	"burnchain-rewards": { path: "burnchain/rewards", rowKey: "rewards" },
	"burnchain-reward-slots": {
		path: "burnchain/reward-slots",
		rowKey: "slots",
	},
	"bns-events": { path: "bns/events", rowKey: "events" },
	"bns-namespace-events": { path: "bns/namespace-events", rowKey: "events" },
	"bns-marketplace-events": {
		path: "bns/marketplace-events",
		rowKey: "events",
	},
};

export class Datasets extends BaseClient {
	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
	}

	/** Dataset catalog + freshness (the discovery endpoint). */
	listDatasets(): Promise<unknown> {
		return this.request("GET", "/v1/datasets");
	}

	/**
	 * Generic cursor query by slug — used by the CLI. Params are passed through as
	 * REST query keys (snake_case), so callers can use the documented filter names
	 * directly. Throws for non-cursor (bespoke) datasets.
	 */
	async query(
		slug: string,
		params: Record<string, unknown> = {},
	): Promise<CursorEnvelope> {
		const d = CURSOR_SLUGS[slug];
		if (!d) {
			throw new Error(
				`unknown cursor dataset "${slug}" (use one of: ${Object.keys(CURSOR_SLUGS).join(", ")})`,
			);
		}
		const env = await this.get<Record<string, unknown>>(
			d.path,
			this.buildParams(params),
		);
		return {
			rows: (env[d.rowKey] as DatasetRow[]) ?? [],
			next_cursor: (env.next_cursor as string | null) ?? null,
			tip: env.tip as { block_height: number } | undefined,
		};
	}

	readonly stxTransfers: CursorDataset<StxTransfersParams> =
		this.cursorDataset<StxTransfersParams>("stx-transfers", "events");
	readonly sbtcEvents: CursorDataset<SbtcEventsParams> =
		this.cursorDataset<SbtcEventsParams>("sbtc/events", "events");
	readonly sbtcTokenEvents: CursorDataset<SbtcTokenEventsParams> =
		this.cursorDataset<SbtcTokenEventsParams>("sbtc/token-events", "events");
	readonly pox4Calls: CursorDataset<Pox4CallsParams> =
		this.cursorDataset<Pox4CallsParams>("pox-4/calls", "calls");
	readonly burnchainRewards: CursorDataset<BurnchainRewardsParams> =
		this.cursorDataset<BurnchainRewardsParams>("burnchain/rewards", "rewards");
	readonly burnchainRewardSlots: CursorDataset<BurnchainRewardSlotsParams> =
		this.cursorDataset<BurnchainRewardSlotsParams>(
			"burnchain/reward-slots",
			"slots",
		);
	readonly bnsEvents: CursorDataset<BnsEventsParams> =
		this.cursorDataset<BnsEventsParams>("bns/events", "events");
	readonly bnsNamespaceEvents: CursorDataset<BnsNamespaceEventsParams> =
		this.cursorDataset<BnsNamespaceEventsParams>(
			"bns/namespace-events",
			"events",
		);
	readonly bnsMarketplaceEvents: CursorDataset<BnsMarketplaceEventsParams> =
		this.cursorDataset<BnsMarketplaceEventsParams>(
			"bns/marketplace-events",
			"events",
		);

	// ── Bespoke (non-cursor) datasets ──────────────────────────────────────

	/** BNS names — offset-paginated. */
	bnsNames(
		params: {
			namespace?: string;
			owner?: string;
			limit?: number;
			offset?: number;
		} = {},
	): Promise<{ names: DatasetRow[] }> {
		const sp = new URLSearchParams();
		appendParam(sp, "namespace", params.namespace);
		appendParam(sp, "owner", params.owner);
		appendParam(sp, "limit", params.limit);
		appendParam(sp, "offset", params.offset);
		return this.get("bns/names", sp);
	}

	/** All BNS namespaces (no pagination). */
	bnsNamespaces(): Promise<{ namespaces: DatasetRow[] }> {
		return this.get("bns/namespaces", new URLSearchParams());
	}

	/** Resolve a fully-qualified BNS name → single record. */
	bnsResolve(fqn: string): Promise<{ name: DatasetRow | null }> {
		const sp = new URLSearchParams();
		sp.set("fqn", fqn);
		return this.get("bns/resolve", sp);
	}

	/** Network health summary. */
	networkHealth(): Promise<{ summary: DatasetRow }> {
		return this.get("network-health/summary", new URLSearchParams());
	}

	// ── internals ──────────────────────────────────────────────────────────

	private get<T>(path: string, sp: URLSearchParams): Promise<T> {
		const qs = sp.toString();
		return this.request<T>("GET", `/v1/datasets/${path}${qs ? `?${qs}` : ""}`);
	}

	private buildParams(params: Record<string, unknown>): URLSearchParams {
		const sp = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) {
			if (v === undefined || v === null || k === "batchSize" || k === "signal")
				continue;
			appendParam(sp, PARAM_KEYS[k] ?? k, v as string | number);
		}
		return sp;
	}

	private cursorDataset<P extends CursorListParams>(
		path: string,
		rowKey: string,
	): CursorDataset<P> {
		const list = async (params: P = {} as P): Promise<CursorEnvelope> => {
			const envelope = await this.get<Record<string, unknown>>(
				path,
				this.buildParams(params as Record<string, unknown>),
			);
			return {
				rows: (envelope[rowKey] as DatasetRow[]) ?? [],
				next_cursor: (envelope.next_cursor as string | null) ?? null,
				tip: envelope.tip as { block_height: number } | undefined,
			};
		};
		const walk = async function* (
			this: Datasets,
			params: P & { batchSize?: number; signal?: AbortSignal } = {} as P,
		): AsyncGenerator<DatasetRow> {
			const batchSize = params.batchSize ?? 200;
			let cursor = params.cursor ?? null;
			let first = true;
			while (!params.signal?.aborted) {
				const env = await list({
					...params,
					limit: batchSize,
					cursor: first ? params.cursor : (cursor ?? undefined),
				} as P);
				for (const row of env.rows) {
					if (params.signal?.aborted) return;
					yield row;
				}
				if (
					!env.next_cursor ||
					env.next_cursor === cursor ||
					env.rows.length < batchSize
				)
					return;
				cursor = env.next_cursor;
				first = false;
			}
		}.bind(this);
		return { list, walk };
	}
}
