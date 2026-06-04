// Canonical decoded event-type vocab lives in @secondlayer/shared; re-exported
// here so the public Streams surface (StreamsEventType) is unchanged.
import {
	STREAMS_EVENT_TYPES,
	type StreamsEventType,
} from "@secondlayer/shared";

export { STREAMS_EVENT_TYPES, type StreamsEventType };

/** A Clarity value as Streams serves it: the canonical hex string, a typed
 *  object carrying that hex (`{ hex }`), or a decoded Clarity-JSON object.
 *  Decode helpers (`decodeNftTransfer`, etc.) resolve it to a concrete value. */
export type StreamsClarityValue =
	| string
	| { hex: string }
	| Record<string, unknown>;

export type StxTransferPayload = {
	sender: string;
	recipient: string;
	amount: string;
	memo?: string;
};
export type StxMintPayload = { recipient: string; amount: string };
export type StxBurnPayload = { sender: string; amount: string };
export type StxLockPayload = {
	locked_address: string;
	locked_amount: string;
	unlock_height: string;
};
export type FtTransferPayload = {
	asset_identifier: string;
	sender: string;
	recipient: string;
	amount: string;
};
export type FtMintPayload = {
	asset_identifier: string;
	recipient: string;
	amount: string;
};
export type FtBurnPayload = {
	asset_identifier: string;
	sender: string;
	amount: string;
};
export type NftTransferPayload = {
	asset_identifier: string;
	sender: string;
	recipient: string;
	value: StreamsClarityValue;
	/** Canonical serialized hex of `value`, when the stream carries it. */
	raw_value?: string;
};
export type NftMintPayload = {
	asset_identifier: string;
	recipient: string;
	value: StreamsClarityValue;
	raw_value?: string;
};
export type NftBurnPayload = {
	asset_identifier: string;
	sender: string;
	value: StreamsClarityValue;
	raw_value?: string;
};
export type PrintPayload = {
	contract_id?: string | null;
	topic?: string;
	value?: unknown;
	raw_value?: string;
};

/** Union of every Streams payload shape, discriminated by `event_type` on the
 *  parent `StreamsEvent`. */
export type StreamsEventPayload =
	| StxTransferPayload
	| StxMintPayload
	| StxBurnPayload
	| StxLockPayload
	| FtTransferPayload
	| FtMintPayload
	| FtBurnPayload
	| NftTransferPayload
	| NftMintPayload
	| NftBurnPayload
	| PrintPayload;

export type StreamsEventBase = {
	/**
	 * Globally unique, monotonic position of this event (`<block>:<index>`). Use
	 * it as the primary key of your projection rows — replaying a batch then
	 * upserts cleanly. Don't synthesize your own id from `tx_id`/`event_index`.
	 */
	cursor: string;
	block_height: number;
	block_hash: string;
	burn_block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	contract_id: string | null;
	ts: string;
	/**
	 * True when this event's block is past the finality boundary (immutable).
	 * Optional for back-compat; the API always sets it on Streams responses.
	 */
	finalized?: boolean;
};

type StreamsEventOf<T extends StreamsEventType, P> = StreamsEventBase & {
	event_type: T;
	payload: P;
};

/** A raw Streams event. Discriminated on `event_type`, so `event.payload`
 *  narrows to the matching payload shape once the type is checked. */
export type StreamsEvent =
	| StreamsEventOf<"stx_transfer", StxTransferPayload>
	| StreamsEventOf<"stx_mint", StxMintPayload>
	| StreamsEventOf<"stx_burn", StxBurnPayload>
	| StreamsEventOf<"stx_lock", StxLockPayload>
	| StreamsEventOf<"ft_transfer", FtTransferPayload>
	| StreamsEventOf<"ft_mint", FtMintPayload>
	| StreamsEventOf<"ft_burn", FtBurnPayload>
	| StreamsEventOf<"nft_transfer", NftTransferPayload>
	| StreamsEventOf<"nft_mint", NftMintPayload>
	| StreamsEventOf<"nft_burn", NftBurnPayload>
	| StreamsEventOf<"print", PrintPayload>;

export type StreamsTip = {
	block_height: number;
	block_hash: string;
	burn_block_height: number;
	/**
	 * Highest Stacks block past the burn-confirmation finality boundary.
	 * Optional for back-compat; the API always sets it.
	 */
	finalized_height?: number;
	lag_seconds: number;
};

export type StreamsCanonicalBlock = {
	block_height: number;
	block_hash: string;
	burn_block_height: number;
	burn_block_hash: string | null;
	is_canonical: true;
};

export type StreamsReorg = {
	detected_at: string;
	fork_point_height: number;
	orphaned_range: { from: string; to: string };
	new_canonical_tip: string;
};

export type StreamsEventsEnvelope = {
	events: StreamsEvent[];
	next_cursor: string | null;
	tip: StreamsTip;
	reorgs: StreamsReorg[];
};

export type StreamsEventsListEnvelope = Omit<
	StreamsEventsEnvelope,
	"next_cursor"
>;

export type StreamsReorgsListParams = {
	since: string;
	limit?: number;
};

export type StreamsReorgsListEnvelope = {
	reorgs: StreamsReorg[];
	next_since: string | null;
};

/** A filter that matches a single value or any value in a list. */
export type StreamsFilterValue = string | readonly string[];

export type StreamsEventsListParams = {
	cursor?: string | null;
	fromHeight?: number;
	toHeight?: number;
	types?: readonly StreamsEventType[];
	/** Event types to exclude (applied after `types`). */
	notTypes?: readonly StreamsEventType[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
	limit?: number;
};

export type StreamsEventsStreamParams = {
	fromCursor?: string | null;
	types?: readonly StreamsEventType[];
	notTypes?: readonly StreamsEventType[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
	batchSize?: number;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
};

/**
 * The checkpoint the SDK computes for a batch. Persist `cursor` inside the same
 * transaction as your projection writes, then resume from it via `fromCursor`.
 * It is the position to advance to: `next_cursor` normally, or the last
 * finalized event when `finalizedOnly` is set.
 */
export type StreamsBatchContext = { cursor: string | null };

/**
 * The checkpoint for a reorg rollback. Persist `cursor` (the rewind position)
 * inside the same transaction as your rollback so the two commit atomically.
 */
export type StreamsReorgContext = { cursor: string };

export type StreamsEventsConsumeParams = {
	fromCursor?: string | null;
	mode?: "tail" | "bounded";
	/**
	 * Emit only finalized (immutable) events and never surface reorgs. The SDK
	 * checkpoints at the last finalized event and re-reads the unfinalized tail
	 * until it settles. Trades finality lag for zero reorg handling; `onReorg` is
	 * ignored.
	 */
	finalizedOnly?: boolean;
	types?: readonly StreamsEventType[];
	notTypes?: readonly StreamsEventType[];
	contractId?: StreamsFilterValue;
	sender?: StreamsFilterValue;
	recipient?: StreamsFilterValue;
	assetIdentifier?: string;
	batchSize?: number;
	/**
	 * Apply a page of canonical events. Persist `ctx.cursor` in the same
	 * transaction as your writes. Returning a cursor overrides `ctx.cursor` as
	 * the resume point (advanced manual control); returning nothing uses it.
	 */
	onBatch: (
		events: StreamsEvent[],
		envelope: StreamsEventsEnvelope,
		ctx: StreamsBatchContext,
	) =>
		| void
		| string
		| null
		| undefined
		| Promise<void>
		| Promise<string | null | undefined>;
	/**
	 * Roll your projection back to `reorg.fork_point_height`, persisting
	 * `ctx.cursor` in the same transaction. Called once per *new* reorg
	 * (deduped in-memory, fork-ascending) before the SDK rewinds and re-reads the
	 * now-canonical events. Omit it to ignore reorgs (events stay canonical, but
	 * stale rows from an orphaned fork are left in place).
	 */
	onReorg?: (
		reorg: StreamsReorg,
		ctx: StreamsReorgContext,
	) => Promise<void> | void;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
};

export type StreamsEventsConsumeResult = {
	cursor: string | null;
	pages: number;
	emptyPolls: number;
};

export type StreamsEventsReplayParams = {
	/** Start point: `"genesis"` (default) or a `<block>:<index>` cursor. */
	from?: "genesis" | string;
	/**
	 * Called once per finalized dump file, in block order, before live tailing.
	 * Process the parquet with your own tooling (e.g. DuckDB) — the SDK does not
	 * decode parquet. Use `client.dumps.download(file)` to fetch + verify bytes.
	 */
	onDumpFile: (file: StreamsDumpFile) => Promise<void> | void;
	/** Called per live page after the dump phase, like `consume`. */
	onBatch: (
		events: StreamsEvent[],
		envelope: StreamsEventsEnvelope,
	) => Promise<string | null | undefined> | string | null | undefined;
	mode?: "tail" | "bounded";
	batchSize?: number;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
};

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

/** One bulk parquet file in the dumps manifest. `path` is the object key under
 *  the dumps base URL. */
export type StreamsDumpFile = {
	path: string;
	from_block: number;
	to_block: number;
	min_cursor: string | null;
	max_cursor: string | null;
	row_count: number;
	byte_size: number;
	sha256: string;
	schema_version: number;
	created_at: string;
};

export type StreamsDumpsManifest = {
	dataset: string;
	network: string;
	version: string;
	schema_version: number;
	generated_at: string;
	producer_version: string;
	finality_lag_blocks: number;
	/** Cursor at the end of the finalized bulk coverage — hand to live tailing. */
	latest_finalized_cursor: string | null;
	coverage: { from_block: number; to_block: number };
	files: StreamsDumpFile[];
};

export type StreamsDumps = {
	/** Fetch and parse the latest dumps manifest. */
	list(): Promise<StreamsDumpsManifest>;
	/** Absolute URL for a manifest file. */
	fileUrl(file: StreamsDumpFile): string;
	/** Download a parquet file and verify its sha256 against the manifest. */
	download(file: StreamsDumpFile): Promise<Uint8Array>;
};

export type StreamsClient = {
	events: {
		list(params?: StreamsEventsListParams): Promise<StreamsEventsEnvelope>;
		byTxId(txId: string): Promise<StreamsEventsListEnvelope>;
		/**
		 * Pull pages from Streams and call `onBatch` after each page.
		 *
		 * Use `consume` for indexers and ETL jobs that own checkpointing. Return
		 * the checkpoint cursor from `onBatch`. Default `mode: "tail"` keeps
		 * polling when caught up; `mode: "bounded"` exits on the first empty page.
		 * The consumer also exits when `maxPages`, `maxEmptyPolls`, or `signal`
		 * stops it.
		 */
		consume(
			params: StreamsEventsConsumeParams,
		): Promise<StreamsEventsConsumeResult>;
		/**
		 * Backfill from bulk dumps, then continue live from the dump→live seam in
		 * one call. Iterates finalized dump files (via `onDumpFile`) in block
		 * order, then tails live from the manifest's `latest_finalized_cursor`
		 * (exclusive input → no gap or duplicate at the seam). Requires
		 * `dumpsBaseUrl`.
		 */
		replay(
			params: StreamsEventsReplayParams,
		): Promise<StreamsEventsConsumeResult>;
		/**
		 * Follow Streams as an async iterator.
		 *
		 * Use `stream` for live processors and watch-style apps. It tails
		 * indefinitely by default and stops when its `AbortSignal`, `maxPages`, or
		 * `maxEmptyPolls` stops it.
		 */
		stream(params?: StreamsEventsStreamParams): AsyncIterable<StreamsEvent>;
	};
	blocks: {
		events(heightOrHash: number | string): Promise<StreamsEventsListEnvelope>;
	};
	reorgs: {
		list(params: StreamsReorgsListParams): Promise<StreamsReorgsListEnvelope>;
	};
	/** Bulk parquet dumps. Requires `dumpsBaseUrl` on the client. */
	dumps: StreamsDumps;
	canonical(height: number): Promise<StreamsCanonicalBlock>;
	tip(): Promise<StreamsTip>;
};
