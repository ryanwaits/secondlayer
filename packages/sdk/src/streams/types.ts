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
	index_block_hash: string;
	burn_block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: StreamsEventType;
	contract_id: string | null;
	payload: StreamsEventPayload;
	ts: string;
};

export type StreamsTip = {
	block_height: number;
	index_block_hash: string;
	burn_block_height: number;
	lag_seconds: number;
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

export type StreamsEventsListParams = {
	cursor?: string | null;
	fromHeight?: number;
	toHeight?: number;
	types?: readonly StreamsEventType[];
	limit?: number;
};

export type StreamsEventsStreamParams = {
	fromCursor?: string | null;
	types?: readonly StreamsEventType[];
	batchSize?: number;
	signal?: AbortSignal;
};

export type StreamsEventsFetchParams = {
	cursor?: string | null;
	limit: number;
	types?: readonly StreamsEventType[];
};

export type StreamsEventsFetcher = (
	params: StreamsEventsFetchParams,
) => Promise<StreamsEventsEnvelope>;

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export type StreamsClient = {
	events: {
		list(params?: StreamsEventsListParams): Promise<StreamsEventsEnvelope>;
		stream(params?: StreamsEventsStreamParams): AsyncIterable<StreamsEvent>;
	};
	tip(): Promise<StreamsTip>;
};
