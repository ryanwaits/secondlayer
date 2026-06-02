import { BaseClient, buildQuery } from "../base.ts";
import type { SecondLayerOptions } from "../base.ts";
import { ApiError } from "../errors.ts";

export type IndexTip = {
	block_height: number;
	lag_seconds: number;
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
	// Reserved envelope field. v1 currently always emits [].
	reorgs: never[];
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
	// Reserved envelope field. v1 currently always emits [].
	reorgs: never[];
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
	reorgs: never[];
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
};

export type EventsWalkParams = Omit<EventsListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

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
	reorgs: never[];
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
};

export type ContractCallsWalkParams = Omit<ContractCallsListParams, "limit"> & {
	batchSize?: number;
	signal?: AbortSignal;
};

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
	reorgs: never[];
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

function firstWalkFromHeight(params: {
	cursor?: string | null;
	fromCursor?: string | null;
	fromHeight?: number;
}): number | undefined {
	if (params.fromHeight !== undefined) return params.fromHeight;
	if (params.cursor || params.fromCursor) return undefined;
	return 0;
}

export class Index extends BaseClient {
	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
	}

	readonly ftTransfers: {
		list: (params?: FtTransfersListParams) => Promise<FtTransfersEnvelope>;
		walk: (params?: FtTransfersWalkParams) => AsyncIterable<FtTransfer>;
	} = {
		list: (params: FtTransfersListParams = {}): Promise<FtTransfersEnvelope> =>
			this.listFtTransfers(params),
		walk: (params: FtTransfersWalkParams = {}): AsyncIterable<FtTransfer> =>
			this.walkFtTransfers(params),
	};

	readonly nftTransfers: {
		list: (params?: NftTransfersListParams) => Promise<NftTransfersEnvelope>;
		walk: (params?: NftTransfersWalkParams) => AsyncIterable<NftTransfer>;
	} = {
		list: (
			params: NftTransfersListParams = {},
		): Promise<NftTransfersEnvelope> => this.listNftTransfers(params),
		walk: (params: NftTransfersWalkParams = {}): AsyncIterable<NftTransfer> =>
			this.walkNftTransfers(params),
	};

	/** Generic decoded events by `event_type` (the full /v1/index/events surface). */
	readonly events: {
		list: (params: EventsListParams) => Promise<EventsEnvelope>;
		walk: (params: EventsWalkParams) => AsyncIterable<IndexEvent>;
	} = {
		list: (params: EventsListParams): Promise<EventsEnvelope> =>
			this.listEvents(params),
		walk: (params: EventsWalkParams): AsyncIterable<IndexEvent> =>
			this.walkEvents(params),
	};

	readonly contractCalls: {
		list: (params?: ContractCallsListParams) => Promise<ContractCallsEnvelope>;
		walk: (
			params?: ContractCallsWalkParams,
		) => AsyncIterable<IndexContractCall>;
	} = {
		list: (
			params: ContractCallsListParams = {},
		): Promise<ContractCallsEnvelope> => this.listContractCalls(params),
		walk: (
			params: ContractCallsWalkParams = {},
		): AsyncIterable<IndexContractCall> => this.walkContractCalls(params),
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
	} = {
		list: (
			params: TransactionsListParams = {},
		): Promise<TransactionsEnvelope> => this.listTransactions(params),
		walk: (
			params: TransactionsWalkParams = {},
		): AsyncIterable<IndexTransaction> => this.walkTransactions(params),
		get: (txId: string): Promise<TransactionEnvelope | null> =>
			this.getTransaction(txId),
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
}
