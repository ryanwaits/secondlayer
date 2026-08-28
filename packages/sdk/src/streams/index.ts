export { createStreamsClient } from "./client.ts";
export { decode } from "./decode.ts";
export {
	AuthError,
	RateLimitError,
	StreamsServerError,
	StreamsSignatureError,
	ValidationError,
} from "./errors.ts";
// ── Per-type guard+decode pairs ─────────────────────────────────────────
// @deprecated (whole block): these 22 helpers return DB-row shapes
// (`decoded_payload` nested, `source_cursor`) and force an 11-branch
// guard+decode dispatch, which is the wrong default for a consumer. Use
// `decode(event)` — one call, the same flat `event_type`-discriminated row
// Index serves — or `decoded: true` on `streams.events.consume`.
//
// They are NOT going away: building a `decoded_events`-shaped projection is a
// real use, and it is what our own decoder does. They move to the explicit
// `@secondlayer/sdk/streams/rows` subpath at the next major, so reaching for
// the storage shape is a deliberate act rather than the first thing autocomplete
// offers. Import from there today.
export {
	decodeFtTransfer,
	isFtTransfer,
	decodeNftTransfer,
	isNftTransfer,
	decodeStxBurn,
	decodeStxLock,
	decodeStxMint,
	decodeStxTransfer,
	isStxBurn,
	isStxLock,
	isStxMint,
	isStxTransfer,
	decodeFtBurn,
	decodeFtMint,
	decodeNftBurn,
	decodeNftMint,
	isFtBurn,
	isFtMint,
	isNftBurn,
	isNftMint,
	decodePrint,
	isPrint,
} from "@secondlayer/shared/streams-rows";
export type {
	DecodedEventColumns,
	DecodedEventRow,
	DecodedFtBurn,
	DecodedFtBurnPayload,
	DecodedFtMint,
	DecodedFtMintPayload,
	DecodedFtTransfer,
	DecodedFtTransferPayload,
	DecodedNftBurn,
	DecodedNftBurnPayload,
	DecodedNftMint,
	DecodedNftMintPayload,
	DecodedNftTransfer,
	DecodedNftTransferPayload,
	DecodedPrint,
	DecodedPrintPayload,
	DecodedPrintValue,
	DecodedStxBurn,
	DecodedStxBurnPayload,
	DecodedStxLock,
	DecodedStxLockPayload,
	DecodedStxMint,
	DecodedStxMintPayload,
	DecodedStxTransfer,
	DecodedStxTransferPayload,
	FtTransferEvent,
	FtTransferPayload,
	NftTransferEvent,
	NftTransferPayload,
} from "@secondlayer/shared/streams-rows";
export { STREAMS_EVENT_TYPES } from "./types.ts";
export { Cursor } from "./cursor.ts";
export type {
	ConsumerBatchContext,
	FetchLike,
	StreamsBatch,
	StreamsBatchContext,
	StreamsClient,
	StreamsConsumeParams,
	StreamsCanonicalBlock,
	StreamsDumpFile,
	StreamsDumps,
	StreamsDumpsManifest,
	StreamsEvent,
	StreamsEventPayload,
	StreamsEventsConsumeParams,
	StreamsEventsConsumeResult,
	StreamsEventsEnvelope,
	StreamsEventsListEnvelope,
	StreamsEventsListParams,
	StreamsEventsStreamParams,
	StreamsEventsSubscribeParams,
	StreamsSubscription,
	StreamsEventType,
	StreamsReorg,
	StreamsReorgContext,
	StreamsReorgsListEnvelope,
	StreamsReorgsListParams,
	StreamsTip,
} from "./types.ts";
