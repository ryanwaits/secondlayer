import type { InferredTopicSchema } from "@secondlayer/subgraphs";
import { BaseClient, buildQuery } from "../base.ts";
import type { SecondLayerOptions } from "../base.ts";
import { ApiError } from "../errors.ts";
import type { TransactionProof } from "../proofs.ts";
import { type IndexConsumeOptions, consumeIndexFeed } from "./consumer.ts";

export type IndexTip = {
	block_height: number;
	/** Highest height treated as immutable (past the burn-confirmation
	 *  finality boundary). Rows at or below it never reorg — `finalizedOnly`
	 *  consumers gate on this, since Index rows carry no per-event flag. */
	finalized_height: number;
	lag_seconds: number;
};

/**
 * A chain reorg overlapping a returned page's height range. Height-keyed feeds
 * (`/transactions`, `/contract-calls`, `/stacking`) populate this so a consumer
 * can reconcile: roll back every row at `block_height >= fork_point_height`
 * (the whole fork block is replaced, so the rollback is inclusive of the fork
 * height), then re-read the canonical run from the foot of `fork_point_height`.
 * The SDK consumers do exactly this — they rewind to `Cursor.atHeight(
 * fork_point_height)`, an exclusive cursor that re-reads from `fork:0`
 * inclusive. Empty when the page spans no reorg.
 */
export type IndexReorg = {
	id: string;
	detected_at: string;
	fork_point_height: number;
	old_index_block_hash: string | null;
	new_index_block_hash: string | null;
	/** Orphaned cursor span `<block_height>:<tx_index>`, inclusive. */
	orphaned_range: { from: string; to: string };
	/**
	 * First position of the new canonical chain at the fork, `fork:0`
	 * (INCLUSIVE). Not an exclusive resume token — resuming a `(bh,ei) > cursor`
	 * read directly from it would skip `fork:0`. To re-read the new run, rewind
	 * to the foot of `fork_point_height` (`Cursor.atHeight`), not to this value.
	 */
	new_canonical_tip: string;
};

export type IndexUsage = {
	product: "index";
	tier: string;
	limits: { rate_limit_per_second: number | null };
	usage: { decoded_events_today: number; decoded_events_this_month: number };
};

export type FtTransfer = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "ft_transfer";
	contract_id: string;
	asset_identifier: string;
	sender: string;
	recipient: string;
	amount: string;
};

export type FtTransfersEnvelope = {
	events: FtTransfer[];
	next_cursor: string | null;
	tip: IndexTip;
	// Chain reorgs overlapping this page's height range; empty when none.
	reorgs: IndexReorg[];
};

export type FtTransfersListParams = {
	cursor?: string | null;
	fromCursor?: string | null;
	limit?: number;
	contractId?: string;
	sender?: string;
	recipient?: string;
	fromHeight?: number;
	toHeight?: number;
};

export type FtTransfersWalkParams = Omit<FtTransfersListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

export type NftTransfer = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "nft_transfer";
	contract_id: string;
	asset_identifier: string;
	sender: string;
	recipient: string;
	value: string;
};

export type NftTransfersEnvelope = {
	events: NftTransfer[];
	next_cursor: string | null;
	tip: IndexTip;
	// Chain reorgs overlapping this page's height range; empty when none.
	reorgs: IndexReorg[];
};

export type NftTransfersListParams = {
	cursor?: string | null;
	fromCursor?: string | null;
	limit?: number;
	contractId?: string;
	assetIdentifier?: string;
	sender?: string;
	recipient?: string;
	fromHeight?: number;
	toHeight?: number;
};

export type NftTransfersWalkParams = Omit<NftTransfersListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

// ── Generic decoded events (/v1/index/events) ──────────────────────

type IndexEventBase = {
	cursor: string;
	block_height: number;
	block_time?: string | null;
	tx_id: string;
	tx_index: number;
	event_index: number;
	contract_id: string | null;
};

export type IndexFtTransfer = IndexEventBase & {
	event_type: "ft_transfer";
	asset_identifier: string;
	sender: string;
	recipient: string;
	amount: string;
};
export type IndexNftTransfer = IndexEventBase & {
	event_type: "nft_transfer";
	asset_identifier: string;
	sender: string;
	recipient: string;
	value: string;
};
export type IndexStxTransfer = IndexEventBase & {
	event_type: "stx_transfer";
	sender: string;
	recipient: string;
	amount: string;
	memo: string | null;
};
export type IndexStxMint = IndexEventBase & {
	event_type: "stx_mint";
	recipient: string;
	amount: string;
};
export type IndexStxBurn = IndexEventBase & {
	event_type: "stx_burn";
	sender: string;
	amount: string;
};
export type IndexStxLock = IndexEventBase & {
	event_type: "stx_lock";
	sender: string;
	amount: string;
	payload: { unlock_height: string | null };
};
export type IndexFtMint = IndexEventBase & {
	event_type: "ft_mint";
	asset_identifier: string;
	recipient: string;
	amount: string;
};
export type IndexFtBurn = IndexEventBase & {
	event_type: "ft_burn";
	asset_identifier: string;
	sender: string;
	amount: string;
};
export type IndexNftMint = IndexEventBase & {
	event_type: "nft_mint";
	asset_identifier: string;
	recipient: string;
	value: string;
};
export type IndexNftBurn = IndexEventBase & {
	event_type: "nft_burn";
	asset_identifier: string;
	sender: string;
	value: string;
};
export type IndexPrint = IndexEventBase & {
	event_type: "print";
	payload: { topic: string | null; value: unknown; raw_value: string | null };
};

/** Decoded chain event, discriminated by `event_type`. */
export type IndexEvent =
	| IndexFtTransfer
	| IndexNftTransfer
	| IndexStxTransfer
	| IndexStxMint
	| IndexStxBurn
	| IndexStxLock
	| IndexFtMint
	| IndexFtBurn
	| IndexNftMint
	| IndexNftBurn
	| IndexPrint;

export type IndexEventType = IndexEvent["event_type"];

export type EventsEnvelope = {
	events: IndexEvent[];
	next_cursor: string | null;
	tip: IndexTip;
	// Chain reorgs overlapping this page's height range; empty when none.
	reorgs: IndexReorg[];
};

export type EventsListParams = {
	/** Required. One of the decoded event types. */
	eventType: IndexEventType;
	cursor?: string | null;
	fromCursor?: string | null;
	limit?: number;
	contractId?: string;
	assetIdentifier?: string;
	sender?: string;
	recipient?: string;
	fromHeight?: number;
	toHeight?: number;
	/** Restrict to contracts conforming to a trait/standard (e.g. "sip-010").
	 *  Mutually exclusive with contractId; contract-keyed event types only. */
	trait?: string;
};

export type EventsWalkParams = Omit<EventsListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

export type EventsConsumeParams = Omit<
	EventsListParams,
	"cursor" | "fromCursor" | "limit"
> &
	IndexConsumeOptions<IndexEvent, EventsEnvelope>;

// ── Contract calls (/v1/index/contract-calls) ──────────────────────

export type IndexContractCall = {
	cursor: string;
	block_height: number;
	block_time?: string | null;
	tx_id: string;
	tx_index: number;
	contract_id: string;
	function_name: string;
	sender: string;
	status: string;
	args: unknown[];
	result: unknown;
	result_hex: string | null;
};

export type ContractCallsEnvelope = {
	contract_calls: IndexContractCall[];
	next_cursor: string | null;
	tip: IndexTip;
	// Chain reorgs overlapping this page's height range; empty when none.
	reorgs: IndexReorg[];
};

export type ContractCallsListParams = {
	cursor?: string | null;
	fromCursor?: string | null;
	limit?: number;
	contractId?: string;
	functionName?: string;
	sender?: string;
	fromHeight?: number;
	toHeight?: number;
	/** Restrict to contracts conforming to a trait/standard (e.g. "sip-010").
	 *  Mutually exclusive with contractId. */
	trait?: string;
};

export type ContractCallsWalkParams = Omit<ContractCallsListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

export type ContractCallsConsumeParams = Omit<
	ContractCallsListParams,
	"cursor" | "fromCursor" | "limit"
> &
	IndexConsumeOptions<IndexContractCall, ContractCallsEnvelope>;

// ── Canonical block-hash map (/v1/index/canonical) ─────────────────

/** One canonical block in the sync map. Lean by design — block + parent hash
 *  for chain linkage, burn anchor for Bitcoin confirmations. Use `blocks` for
 *  the full block resource. */
export type IndexCanonicalBlock = {
	cursor: string;
	block_height: number;
	block_hash: string;
	parent_hash: string;
	burn_block_height: number;
	burn_block_hash: string | null;
};

export type CanonicalEnvelope = {
	canonical: IndexCanonicalBlock[];
	next_cursor: string | null;
	tip: IndexTip;
};

export type CanonicalListParams = {
	cursor?: string | null;
	fromCursor?: string | null;
	limit?: number;
	fromHeight?: number;
	toHeight?: number;
};

export type CanonicalWalkParams = Omit<CanonicalListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

// ── Blocks (/v1/index/blocks) ──────────────────────────────────────

/** A block resource. Metadata is intentionally thin — only chain-linkage and
 *  burn-anchor fields are persisted (no miner / tx_count / signer). */
export type IndexBlock = {
	cursor: string;
	block_height: number;
	block_hash: string;
	parent_hash: string;
	burn_block_height: number;
	burn_block_hash: string | null;
	block_time: string | null;
	canonical: boolean;
};

export type BlocksEnvelope = {
	blocks: IndexBlock[];
	next_cursor: string | null;
	tip: IndexTip;
};

export type BlockEnvelope = {
	block: IndexBlock;
	tip: IndexTip;
};

export type BlocksListParams = {
	cursor?: string | null;
	fromCursor?: string | null;
	limit?: number;
	fromHeight?: number;
	toHeight?: number;
};

export type BlocksWalkParams = Omit<BlocksListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

// ── Transactions (/v1/index/transactions) ──────────────────────────

export type IndexPostCondition =
	| {
			type: "stx";
			principal: string;
			condition_code: number;
			condition_code_name: string | null;
			amount: string;
	  }
	| {
			type: "ft";
			principal: string;
			asset_identifier: string;
			condition_code: number;
			condition_code_name: string | null;
			amount: string;
	  }
	| {
			type: "nft";
			principal: string;
			asset_identifier: string;
			asset_value: unknown;
			condition_code: number;
			condition_code_name: string | null;
	  };

/** Full transaction document: columnar fields plus `raw_tx`-decoded enrichment.
 *  Payload sub-objects are present only for the matching `tx_type`; enrichment
 *  fields are null when `raw_tx` isn't decodable (e.g. burnchain ops). */
export type IndexTransaction = {
	cursor: string;
	tx_id: string;
	block_height: number;
	block_time?: string | null;
	tx_index: number;
	tx_type: string;
	sender: string;
	status: string;
	fee: string | null;
	nonce: string | null;
	sponsored: boolean | null;
	anchor_mode: string | null;
	post_condition_mode: string | null;
	post_conditions: IndexPostCondition[];
	contract_call?: {
		contract_id: string;
		function_name: string;
		function_args: unknown[];
		/** Raw hex-encoded ClarityValues; decode(function_args_hex[i]) === function_args[i]. */
		function_args_hex: string[];
		result: unknown;
		result_hex: string | null;
	};
	token_transfer?: { recipient: string; amount: string; memo: string };
	smart_contract?: {
		contract_id: string | null;
		clarity_version: number | null;
	};
	coinbase?: { alt_recipient: string | null };
	tenure_change?: { cause: number };
};

export type TransactionsEnvelope = {
	transactions: IndexTransaction[];
	next_cursor: string | null;
	tip: IndexTip;
	// Chain reorgs overlapping this page's height range; empty when none.
	reorgs: IndexReorg[];
};

export type TransactionEnvelope = {
	transaction: IndexTransaction;
	tip: IndexTip;
};

export type TransactionsListParams = {
	cursor?: string | null;
	fromCursor?: string | null;
	limit?: number;
	type?: string;
	sender?: string;
	contractId?: string;
	fromHeight?: number;
	toHeight?: number;
};

export type TransactionsWalkParams = Omit<TransactionsListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

// ── Stacking (/v1/index/stacking) ──────────────────────────────────

/** A decoded PoX-4 stacking action (one per stacking contract call). */
export type IndexStackingAction = {
	cursor: string;
	block_height: number;
	block_time?: string | null;
	burn_block_height: number;
	tx_id: string;
	tx_index: number;
	function_name: string;
	caller: string;
	stacker: string | null;
	delegate_to: string | null;
	amount_ustx: string | null;
	lock_period: number | null;
	pox_addr: {
		version: number | null;
		hashbytes: string | null;
		btc: string | null;
	};
	start_cycle: number | null;
	end_cycle: number | null;
	reward_cycle: number | null;
	signer_key: string | null;
	result_ok: boolean;
};

export type StackingEnvelope = {
	stacking: IndexStackingAction[];
	next_cursor: string | null;
	tip: IndexTip;
	// Chain reorgs overlapping this page's height range; empty when none.
	reorgs: IndexReorg[];
	/** Present only when the PoX-4 decoder is disabled, explaining an empty feed. */
	notes?: string;
};

export type StackingListParams = {
	cursor?: string | null;
	fromCursor?: string | null;
	limit?: number;
	functionName?: string;
	stacker?: string;
	caller?: string;
	fromHeight?: number;
	toHeight?: number;
};

export type StackingWalkParams = Omit<StackingListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

// ── Mempool (/v1/index/mempool) ────────────────────────────────────

/** A pending (unconfirmed) transaction. Like a transaction document but
 *  pre-chain — no block_height/tx_index/result/events — with `received_at` and
 *  a sequence cursor instead of a block position. */
export type IndexMempoolTransaction = {
	cursor: string;
	tx_id: string;
	tx_type: string;
	sender: string;
	received_at?: string | null;
	fee: string | null;
	nonce: string | null;
	sponsored: boolean | null;
	anchor_mode: string | null;
	post_condition_mode: string | null;
	post_conditions: IndexPostCondition[];
	contract_call?: {
		contract_id: string;
		function_name: string;
		function_args: unknown[];
	};
	token_transfer?: { recipient: string; amount: string; memo: string };
	smart_contract?: { clarity_version: number | null };
	coinbase?: { alt_recipient: string | null };
	tenure_change?: { cause: number };
};

export type MempoolEnvelope = {
	mempool: IndexMempoolTransaction[];
	next_cursor: string | null;
	tip: IndexTip;
};

export type MempoolTransactionEnvelope = {
	transaction: IndexMempoolTransaction;
	tip: IndexTip;
};

export type MempoolListParams = {
	cursor?: string | null;
	fromCursor?: string | null;
	limit?: number;
	sender?: string;
	type?: string;
	/** Filter to pending calls to a single contract (e.g. `SP….contract`). */
	contractId?: string;
};

export type MempoolWalkParams = Omit<MempoolListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

// ── Print schema (/v1/index/contracts/:contract_id/print-schema) ───

/**
 * Empirical per-topic print payload schema for a contract, inferred from
 * sampled on-chain events. `topics` is sorted by count desc; `sampled` is true
 * when the contract has more print events than the windows examined.
 */
export type PrintSchemaResponse = {
	contract_id: string;
	topics: InferredTopicSchema[];
	sampled: boolean;
	total_events: number;
	/** True when the count hit the server-side cap (total_events is the cap). */
	total_events_capped: boolean;
	sample: {
		size: number;
		newest_height: number | null;
		oldest_height: number | null;
	};
	tip: IndexTip;
};

function firstWalkFromHeight(params: {
	cursor?: string | null;
	fromCursor?: string | null;
	fromHeight?: number;
}): number | undefined {
	if (params.fromHeight !== undefined) return params.fromHeight;
	if (params.cursor || params.fromCursor) return undefined;
	return 0;
}

/**
 * `index.ftTransfers` — callable shorthand for `.list()`, with `.list`/`.walk`
 * still available: `await sl.index.ftTransfers({ contractId })`.
 *
 * The API accepts `contract_id`/`sender`/`recipient` equality filters only —
 * no amount filtering and no asset-slug resolution on /v1/index/ft-transfers.
 */
export interface FtTransfersResource {
	(params?: FtTransfersListParams): Promise<FtTransfersEnvelope>;
	list(params?: FtTransfersListParams): Promise<FtTransfersEnvelope>;
	walk(params?: FtTransfersWalkParams): AsyncIterable<FtTransfer>;
}

/** `index.nftTransfers` — callable shorthand for `.list()` (see {@link FtTransfersResource}). */
export interface NftTransfersResource {
	(params?: NftTransfersListParams): Promise<NftTransfersEnvelope>;
	list(params?: NftTransfersListParams): Promise<NftTransfersEnvelope>;
	walk(params?: NftTransfersWalkParams): AsyncIterable<NftTransfer>;
}

/** `index.events` — callable shorthand for `.list()`; `eventType` is required. */
export interface IndexEventsResource {
	(params: EventsListParams): Promise<EventsEnvelope>;
	list(params: EventsListParams): Promise<EventsEnvelope>;
	walk(params: EventsWalkParams): AsyncIterable<IndexEvent>;
	consume(
		params: EventsConsumeParams,
	): Promise<{ cursor: string | null; pages: number; emptyPolls: number }>;
}

/** Per-event-type filter vocabulary in the {@link IndexDiscovery} doc. */
export type IndexEventTypeFilters = {
	columns?: string[];
	allowed_filters?: string[];
	equality_filters?: string[];
	required_non_null?: string[];
};

/** The `GET /v1/index` discovery doc — live endpoint + filter vocabulary.
 *  Shape is intentionally open (the server may add fields); the agent-relevant
 *  parts are the per-type filter rules. */
export type IndexDiscovery = {
	event_type_filters?: Record<string, IndexEventTypeFilters>;
	[key: string]: unknown;
};

export class Index extends BaseClient {
	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
	}

	/** Your own Index consumption (decoded events today + this month) and tier limits. */
	usage(): Promise<IndexUsage> {
		return this.request<IndexUsage>("GET", "/v1/index/usage");
	}

	/**
	 * Index discovery doc — the live vocabulary: every endpoint, each event type's
	 * columns, allowed/equality filters, and required-non-null fields. Read this to
	 * learn what's queryable (and which types accept `trait`) instead of hardcoding.
	 */
	discover(): Promise<IndexDiscovery> {
		return this.request<IndexDiscovery>("GET", "/v1/index");
	}

	/**
	 * Empirical per-topic print payload schema for a contract — what topics it
	 * emits and each field's observed Clarity/TS/column types. Anonymous read;
	 * 404 → null.
	 */
	async printSchema(contractId: string): Promise<PrintSchemaResponse | null> {
		try {
			return await this.request<PrintSchemaResponse>(
				"GET",
				`/v1/index/contracts/${encodeURIComponent(contractId)}/print-schema`,
			);
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) return null;
			throw err;
		}
	}

	/** Callable: `index.ftTransfers(params)` ≡ `index.ftTransfers.list(params)`. */
	readonly ftTransfers: FtTransfersResource = Object.assign(
		(params: FtTransfersListParams = {}): Promise<FtTransfersEnvelope> =>
			this.listFtTransfers(params),
		{
			list: (
				params: FtTransfersListParams = {},
			): Promise<FtTransfersEnvelope> => this.listFtTransfers(params),
			walk: (params: FtTransfersWalkParams = {}): AsyncIterable<FtTransfer> =>
				this.walkFtTransfers(params),
		},
	);

	/** Callable: `index.nftTransfers(params)` ≡ `index.nftTransfers.list(params)`. */
	readonly nftTransfers: NftTransfersResource = Object.assign(
		(params: NftTransfersListParams = {}): Promise<NftTransfersEnvelope> =>
			this.listNftTransfers(params),
		{
			list: (
				params: NftTransfersListParams = {},
			): Promise<NftTransfersEnvelope> => this.listNftTransfers(params),
			walk: (params: NftTransfersWalkParams = {}): AsyncIterable<NftTransfer> =>
				this.walkNftTransfers(params),
		},
	);

	/** Generic decoded events by `event_type` (the full /v1/index/events surface).
	 *  Callable: `index.events(params)` ≡ `index.events.list(params)`. */
	readonly events: IndexEventsResource = Object.assign(
		(params: EventsListParams): Promise<EventsEnvelope> =>
			this.listEvents(params),
		{
			list: (params: EventsListParams): Promise<EventsEnvelope> =>
				this.listEvents(params),
			walk: (params: EventsWalkParams): AsyncIterable<IndexEvent> =>
				this.walkEvents(params),
			consume: (params: EventsConsumeParams) =>
				consumeIndexFeed<IndexEvent, EventsEnvelope>({
					...params,
					fetchPage: ({ cursor, fromHeight, limit }) =>
						this.listEvents({
							eventType: params.eventType,
							contractId: params.contractId,
							assetIdentifier: params.assetIdentifier,
							sender: params.sender,
							recipient: params.recipient,
							trait: params.trait,
							toHeight: params.toHeight,
							cursor,
							fromHeight,
							limit,
						}),
					itemsOf: (envelope) => envelope.events,
				}),
		},
	);

	readonly contractCalls: {
		list: (params?: ContractCallsListParams) => Promise<ContractCallsEnvelope>;
		walk: (
			params?: ContractCallsWalkParams,
		) => AsyncIterable<IndexContractCall>;
		consume: (
			params: ContractCallsConsumeParams,
		) => Promise<{ cursor: string | null; pages: number; emptyPolls: number }>;
	} = {
		list: (
			params: ContractCallsListParams = {},
		): Promise<ContractCallsEnvelope> => this.listContractCalls(params),
		walk: (
			params: ContractCallsWalkParams = {},
		): AsyncIterable<IndexContractCall> => this.walkContractCalls(params),
		consume: (params: ContractCallsConsumeParams) =>
			consumeIndexFeed<IndexContractCall, ContractCallsEnvelope>({
				...params,
				fetchPage: ({ cursor, fromHeight, limit }) =>
					this.listContractCalls({
						contractId: params.contractId,
						functionName: params.functionName,
						sender: params.sender,
						trait: params.trait,
						toHeight: params.toHeight,
						cursor,
						fromHeight,
						limit,
					}),
				itemsOf: (envelope) => envelope.contract_calls,
			}),
	};

	/** Canonical block-hash map — sync only the current canonical chain. */
	readonly canonical: {
		list: (params?: CanonicalListParams) => Promise<CanonicalEnvelope>;
		walk: (params?: CanonicalWalkParams) => AsyncIterable<IndexCanonicalBlock>;
	} = {
		list: (params: CanonicalListParams = {}): Promise<CanonicalEnvelope> =>
			this.listCanonical(params),
		walk: (
			params: CanonicalWalkParams = {},
		): AsyncIterable<IndexCanonicalBlock> => this.walkCanonical(params),
	};

	/** Canonical blocks: paginated `list`/`walk`, plus `get` by height or hash
	 *  (resolves to null on 404). */
	readonly blocks: {
		list: (params?: BlocksListParams) => Promise<BlocksEnvelope>;
		walk: (params?: BlocksWalkParams) => AsyncIterable<IndexBlock>;
		get: (ref: string | number) => Promise<BlockEnvelope | null>;
	} = {
		list: (params: BlocksListParams = {}): Promise<BlocksEnvelope> =>
			this.listBlocks(params),
		walk: (params: BlocksWalkParams = {}): AsyncIterable<IndexBlock> =>
			this.walkBlocks(params),
		get: (ref: string | number): Promise<BlockEnvelope | null> =>
			this.getBlock(ref),
	};

	/** Full transaction documents: paginated `list`/`walk`, plus `get` by tx_id
	 *  (resolves to null on 404). */
	readonly transactions: {
		list: (params?: TransactionsListParams) => Promise<TransactionsEnvelope>;
		walk: (params?: TransactionsWalkParams) => AsyncIterable<IndexTransaction>;
		get: (txId: string) => Promise<TransactionEnvelope | null>;
		getProof: (txId: string) => Promise<TransactionProof | null>;
	} = {
		list: (
			params: TransactionsListParams = {},
		): Promise<TransactionsEnvelope> => this.listTransactions(params),
		walk: (
			params: TransactionsWalkParams = {},
		): AsyncIterable<IndexTransaction> => this.walkTransactions(params),
		get: (txId: string): Promise<TransactionEnvelope | null> =>
			this.getTransaction(txId),
		getProof: (txId: string): Promise<TransactionProof | null> =>
			this.getTransactionProof(txId),
	};

	/** Decoded PoX-4 stacking actions. Empty (with a `notes` hint) when the
	 *  platform's PoX-4 decoder is disabled. */
	readonly stacking: {
		list: (params?: StackingListParams) => Promise<StackingEnvelope>;
		walk: (params?: StackingWalkParams) => AsyncIterable<IndexStackingAction>;
	} = {
		list: (params: StackingListParams = {}): Promise<StackingEnvelope> =>
			this.listStacking(params),
		walk: (
			params: StackingWalkParams = {},
		): AsyncIterable<IndexStackingAction> => this.walkStacking(params),
	};

	/** Pending (unconfirmed) transactions: paginated `list`/`walk`, plus `get` by
	 *  tx_id (resolves to null when the tx has confirmed or dropped). */
	readonly mempool: {
		list: (params?: MempoolListParams) => Promise<MempoolEnvelope>;
		walk: (
			params?: MempoolWalkParams,
		) => AsyncIterable<IndexMempoolTransaction>;
		get: (txId: string) => Promise<MempoolTransactionEnvelope | null>;
	} = {
		list: (params: MempoolListParams = {}): Promise<MempoolEnvelope> =>
			this.listMempool(params),
		walk: (
			params: MempoolWalkParams = {},
		): AsyncIterable<IndexMempoolTransaction> => this.walkMempool(params),
		get: (txId: string): Promise<MempoolTransactionEnvelope | null> =>
			this.getMempoolTx(txId),
	};

	private async listFtTransfers(
		params: FtTransfersListParams = {},
	): Promise<FtTransfersEnvelope> {
		return this.request<FtTransfersEnvelope>(
			"GET",
			`/v1/index/ft-transfers${buildQuery({
				cursor: params.cursor,
				from_cursor: params.fromCursor,
				limit: params.limit,
				contract_id: params.contractId,
				sender: params.sender,
				recipient: params.recipient,
				from_height: params.fromHeight,
				to_height: params.toHeight,
			})}`,
		);
	}

	private async listNftTransfers(
		params: NftTransfersListParams = {},
	): Promise<NftTransfersEnvelope> {
		return this.request<NftTransfersEnvelope>(
			"GET",
			`/v1/index/nft-transfers${buildQuery({
				cursor: params.cursor,
				from_cursor: params.fromCursor,
				limit: params.limit,
				contract_id: params.contractId,
				asset_identifier: params.assetIdentifier,
				sender: params.sender,
				recipient: params.recipient,
				from_height: params.fromHeight,
				to_height: params.toHeight,
			})}`,
		);
	}

	private async *walkFtTransfers(
		params: FtTransfersWalkParams = {},
	): AsyncGenerator<FtTransfer> {
		const batchSize = params.batchSize ?? 200;
		let cursor = params.cursor ?? params.fromCursor ?? null;
		let firstPage = true;

		while (!params.signal?.aborted) {
			const envelope = await this.listFtTransfers({
				...params,
				limit: batchSize,
				cursor: firstPage ? params.cursor : cursor,
				fromCursor: firstPage ? params.fromCursor : undefined,
				fromHeight: firstPage ? firstWalkFromHeight(params) : undefined,
			});

			for (const event of envelope.events) {
				if (params.signal?.aborted) return;
				yield event;
			}

			const nextCursor = envelope.next_cursor;
			if (
				!nextCursor ||
				nextCursor === cursor ||
				envelope.events.length < batchSize
			) {
				return;
			}

			cursor = nextCursor;
			firstPage = false;
		}
	}

	private async *walkNftTransfers(
		params: NftTransfersWalkParams = {},
	): AsyncGenerator<NftTransfer> {
		const batchSize = params.batchSize ?? 200;
		let cursor = params.cursor ?? params.fromCursor ?? null;
		let firstPage = true;

		while (!params.signal?.aborted) {
			const envelope = await this.listNftTransfers({
				...params,
				limit: batchSize,
				cursor: firstPage ? params.cursor : cursor,
				fromCursor: firstPage ? params.fromCursor : undefined,
				fromHeight: firstPage ? firstWalkFromHeight(params) : undefined,
			});

			for (const event of envelope.events) {
				if (params.signal?.aborted) return;
				yield event;
			}

			const nextCursor = envelope.next_cursor;
			if (
				!nextCursor ||
				nextCursor === cursor ||
				envelope.events.length < batchSize
			) {
				return;
			}

			cursor = nextCursor;
			firstPage = false;
		}
	}

	private async listEvents(params: EventsListParams): Promise<EventsEnvelope> {
		return this.request<EventsEnvelope>(
			"GET",
			`/v1/index/events${buildQuery({
				event_type: params.eventType,
				cursor: params.cursor,
				from_cursor: params.fromCursor,
				limit: params.limit,
				contract_id: params.contractId,
				asset_identifier: params.assetIdentifier,
				sender: params.sender,
				recipient: params.recipient,
				from_height: params.fromHeight,
				to_height: params.toHeight,
				trait: params.trait,
			})}`,
		);
	}

	private async *walkEvents(
		params: EventsWalkParams,
	): AsyncGenerator<IndexEvent> {
		const batchSize = params.batchSize ?? 200;
		let cursor = params.cursor ?? params.fromCursor ?? null;
		let firstPage = true;

		while (!params.signal?.aborted) {
			const envelope = await this.listEvents({
				...params,
				limit: batchSize,
				cursor: firstPage ? params.cursor : cursor,
				fromCursor: firstPage ? params.fromCursor : undefined,
				fromHeight: firstPage ? firstWalkFromHeight(params) : undefined,
			});

			for (const event of envelope.events) {
				if (params.signal?.aborted) return;
				yield event;
			}

			const nextCursor = envelope.next_cursor;
			if (
				!nextCursor ||
				nextCursor === cursor ||
				envelope.events.length < batchSize
			) {
				return;
			}

			cursor = nextCursor;
			firstPage = false;
		}
	}

	private async listContractCalls(
		params: ContractCallsListParams = {},
	): Promise<ContractCallsEnvelope> {
		return this.request<ContractCallsEnvelope>(
			"GET",
			`/v1/index/contract-calls${buildQuery({
				cursor: params.cursor,
				from_cursor: params.fromCursor,
				limit: params.limit,
				contract_id: params.contractId,
				function_name: params.functionName,
				sender: params.sender,
				from_height: params.fromHeight,
				to_height: params.toHeight,
				trait: params.trait,
			})}`,
		);
	}

	private async *walkContractCalls(
		params: ContractCallsWalkParams = {},
	): AsyncGenerator<IndexContractCall> {
		const batchSize = params.batchSize ?? 200;
		let cursor = params.cursor ?? params.fromCursor ?? null;
		let firstPage = true;

		while (!params.signal?.aborted) {
			const envelope = await this.listContractCalls({
				...params,
				limit: batchSize,
				cursor: firstPage ? params.cursor : cursor,
				fromCursor: firstPage ? params.fromCursor : undefined,
				fromHeight: firstPage ? firstWalkFromHeight(params) : undefined,
			});

			for (const call of envelope.contract_calls) {
				if (params.signal?.aborted) return;
				yield call;
			}

			const nextCursor = envelope.next_cursor;
			if (
				!nextCursor ||
				nextCursor === cursor ||
				envelope.contract_calls.length < batchSize
			) {
				return;
			}

			cursor = nextCursor;
			firstPage = false;
		}
	}

	private async listCanonical(
		params: CanonicalListParams = {},
	): Promise<CanonicalEnvelope> {
		return this.request<CanonicalEnvelope>(
			"GET",
			`/v1/index/canonical${buildQuery({
				cursor: params.cursor,
				from_cursor: params.fromCursor,
				limit: params.limit,
				from_height: params.fromHeight,
				to_height: params.toHeight,
			})}`,
		);
	}

	private async *walkCanonical(
		params: CanonicalWalkParams = {},
	): AsyncGenerator<IndexCanonicalBlock> {
		const batchSize = params.batchSize ?? 200;
		let cursor = params.cursor ?? params.fromCursor ?? null;
		let firstPage = true;

		while (!params.signal?.aborted) {
			const envelope = await this.listCanonical({
				...params,
				limit: batchSize,
				cursor: firstPage ? params.cursor : cursor,
				fromCursor: firstPage ? params.fromCursor : undefined,
				fromHeight: firstPage ? firstWalkFromHeight(params) : undefined,
			});

			for (const block of envelope.canonical) {
				if (params.signal?.aborted) return;
				yield block;
			}

			const nextCursor = envelope.next_cursor;
			if (
				!nextCursor ||
				nextCursor === cursor ||
				envelope.canonical.length < batchSize
			) {
				return;
			}

			cursor = nextCursor;
			firstPage = false;
		}
	}

	private async listBlocks(
		params: BlocksListParams = {},
	): Promise<BlocksEnvelope> {
		return this.request<BlocksEnvelope>(
			"GET",
			`/v1/index/blocks${buildQuery({
				cursor: params.cursor,
				from_cursor: params.fromCursor,
				limit: params.limit,
				from_height: params.fromHeight,
				to_height: params.toHeight,
			})}`,
		);
	}

	private async getBlock(ref: string | number): Promise<BlockEnvelope | null> {
		try {
			return await this.request<BlockEnvelope>(
				"GET",
				`/v1/index/blocks/${encodeURIComponent(String(ref))}`,
			);
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) return null;
			throw err;
		}
	}

	private async *walkBlocks(
		params: BlocksWalkParams = {},
	): AsyncGenerator<IndexBlock> {
		const batchSize = params.batchSize ?? 200;
		let cursor = params.cursor ?? params.fromCursor ?? null;
		let firstPage = true;

		while (!params.signal?.aborted) {
			const envelope = await this.listBlocks({
				...params,
				limit: batchSize,
				cursor: firstPage ? params.cursor : cursor,
				fromCursor: firstPage ? params.fromCursor : undefined,
				fromHeight: firstPage ? firstWalkFromHeight(params) : undefined,
			});

			for (const block of envelope.blocks) {
				if (params.signal?.aborted) return;
				yield block;
			}

			const nextCursor = envelope.next_cursor;
			if (
				!nextCursor ||
				nextCursor === cursor ||
				envelope.blocks.length < batchSize
			) {
				return;
			}

			cursor = nextCursor;
			firstPage = false;
		}
	}

	private async listTransactions(
		params: TransactionsListParams = {},
	): Promise<TransactionsEnvelope> {
		return this.request<TransactionsEnvelope>(
			"GET",
			`/v1/index/transactions${buildQuery({
				cursor: params.cursor,
				from_cursor: params.fromCursor,
				limit: params.limit,
				type: params.type,
				sender: params.sender,
				contract_id: params.contractId,
				from_height: params.fromHeight,
				to_height: params.toHeight,
			})}`,
		);
	}

	private async getTransaction(
		txId: string,
	): Promise<TransactionEnvelope | null> {
		try {
			return await this.request<TransactionEnvelope>(
				"GET",
				`/v1/index/transactions/${encodeURIComponent(txId)}`,
			);
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) return null;
			throw err;
		}
	}

	/** Fetch the inclusion proof for a tx (raw tx + Nakamoto header + merkle path)
	 *  to verify client-side with `verifyTransactionProof`. 404 → null. A 503
	 *  (`PROOF_TX_SET_INCOMPLETE` / `PROOF_NODE_UNAVAILABLE`) surfaces as an
	 *  ApiError — the proof can't be assembled on this deployment right now. */
	private async getTransactionProof(
		txId: string,
	): Promise<TransactionProof | null> {
		try {
			return await this.request<TransactionProof>(
				"GET",
				`/v1/index/transactions/${encodeURIComponent(txId)}/proof`,
			);
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) return null;
			throw err;
		}
	}

	private async *walkTransactions(
		params: TransactionsWalkParams = {},
	): AsyncGenerator<IndexTransaction> {
		const batchSize = params.batchSize ?? 200;
		let cursor = params.cursor ?? params.fromCursor ?? null;
		let firstPage = true;

		while (!params.signal?.aborted) {
			const envelope = await this.listTransactions({
				...params,
				limit: batchSize,
				cursor: firstPage ? params.cursor : cursor,
				fromCursor: firstPage ? params.fromCursor : undefined,
				fromHeight: firstPage ? firstWalkFromHeight(params) : undefined,
			});

			for (const tx of envelope.transactions) {
				if (params.signal?.aborted) return;
				yield tx;
			}

			const nextCursor = envelope.next_cursor;
			if (
				!nextCursor ||
				nextCursor === cursor ||
				envelope.transactions.length < batchSize
			) {
				return;
			}

			cursor = nextCursor;
			firstPage = false;
		}
	}

	private async listStacking(
		params: StackingListParams = {},
	): Promise<StackingEnvelope> {
		return this.request<StackingEnvelope>(
			"GET",
			`/v1/index/stacking${buildQuery({
				cursor: params.cursor,
				from_cursor: params.fromCursor,
				limit: params.limit,
				function_name: params.functionName,
				stacker: params.stacker,
				caller: params.caller,
				from_height: params.fromHeight,
				to_height: params.toHeight,
			})}`,
		);
	}

	private async *walkStacking(
		params: StackingWalkParams = {},
	): AsyncGenerator<IndexStackingAction> {
		const batchSize = params.batchSize ?? 200;
		let cursor = params.cursor ?? params.fromCursor ?? null;
		let firstPage = true;

		while (!params.signal?.aborted) {
			const envelope = await this.listStacking({
				...params,
				limit: batchSize,
				cursor: firstPage ? params.cursor : cursor,
				fromCursor: firstPage ? params.fromCursor : undefined,
				fromHeight: firstPage ? firstWalkFromHeight(params) : undefined,
			});

			for (const action of envelope.stacking) {
				if (params.signal?.aborted) return;
				yield action;
			}

			const nextCursor = envelope.next_cursor;
			if (
				!nextCursor ||
				nextCursor === cursor ||
				envelope.stacking.length < batchSize
			) {
				return;
			}

			cursor = nextCursor;
			firstPage = false;
		}
	}

	private async listMempool(
		params: MempoolListParams = {},
	): Promise<MempoolEnvelope> {
		return this.request<MempoolEnvelope>(
			"GET",
			`/v1/index/mempool${buildQuery({
				cursor: params.cursor,
				from_cursor: params.fromCursor,
				limit: params.limit,
				sender: params.sender,
				type: params.type,
				contract_id: params.contractId,
			})}`,
		);
	}

	private async getMempoolTx(
		txId: string,
	): Promise<MempoolTransactionEnvelope | null> {
		try {
			return await this.request<MempoolTransactionEnvelope>(
				"GET",
				`/v1/index/mempool/${encodeURIComponent(txId)}`,
			);
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) return null;
			throw err;
		}
	}

	private async *walkMempool(
		params: MempoolWalkParams = {},
	): AsyncGenerator<IndexMempoolTransaction> {
		const batchSize = params.batchSize ?? 200;
		let cursor = params.cursor ?? params.fromCursor ?? null;
		let firstPage = true;

		while (!params.signal?.aborted) {
			const envelope = await this.listMempool({
				...params,
				limit: batchSize,
				cursor: firstPage ? params.cursor : cursor,
				fromCursor: firstPage ? params.fromCursor : undefined,
			});

			for (const tx of envelope.mempool) {
				if (params.signal?.aborted) return;
				yield tx;
			}

			const nextCursor = envelope.next_cursor;
			if (
				!nextCursor ||
				nextCursor === cursor ||
				envelope.mempool.length < batchSize
			) {
				return;
			}

			cursor = nextCursor;
			firstPage = false;
		}
	}
}
