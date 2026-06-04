// The decoded event-type vocabulary. Index (decoded layer) and Streams
// (canonical firehose) expose the SAME set, so they share one source here.
// Previously this list was duplicated as a literal in sdk/streams,
// indexer/streams-events, and the mcp index/streams tools — drift risk. Every
// consumer now imports from this module (sdk + indexer re-export it under the
// `STREAMS_EVENT_TYPES` name for back-compat).
export const DECODED_EVENT_TYPES = [
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

export type DecodedEventType = (typeof DECODED_EVENT_TYPES)[number];

/** Alias kept for the Streams surface (identical to {@link DECODED_EVENT_TYPES}).
 *  Explicit type annotation required — isolatedDeclarations emits `unknown` for
 *  a bare const-to-const alias. */
export const STREAMS_EVENT_TYPES: typeof DECODED_EVENT_TYPES =
	DECODED_EVENT_TYPES;
export type StreamsEventType = DecodedEventType;
