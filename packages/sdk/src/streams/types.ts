export const STREAMS_EVENT_TYPES = [
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"print",
] as const;

export type StreamsEventType = (typeof STREAMS_EVENT_TYPES)[number];

export type StreamsEventPayload = Record<string, unknown>;

export type StreamsEvent = {
	cursor: string;
	block_height: number;
	block_hash: string;
	burn_block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: StreamsEventType;
	contract_id: string | null;
	payload: StreamsEventPayload;
	ts: string;
	/**
	 * True when this event's block is past the finality boundary (immutable).
	 * Optional for back-compat; the API always sets it on Streams responses.
	 */
	finalized?: boolean;
};

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

export type StreamsEventsListParams = {
	cursor?: string | null;
	fromHeight?: number;
	toHeight?: number;
	types?: readonly StreamsEventType[];
	contractId?: string;
	sender?: string;
	recipient?: string;
	assetIdentifier?: string;
	limit?: number;
};

export type StreamsEventsStreamParams = {
	fromCursor?: string | null;
	types?: readonly StreamsEventType[];
	contractId?: string;
	sender?: string;
	recipient?: string;
	assetIdentifier?: string;
	batchSize?: number;
	emptyBackoffMs?: number;
	maxPages?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
};

export type StreamsEventsConsumeParams = {
	fromCursor?: string | null;
	mode?: "tail" | "bounded";
	types?: readonly StreamsEventType[];
	contractId?: string;
	sender?: string;
	recipient?: string;
	assetIdentifier?: string;
	batchSize?: number;
	onBatch: (
		events: StreamsEvent[],
		envelope: StreamsEventsEnvelope,
	) => Promise<string | null | undefined> | string | null | undefined;
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
