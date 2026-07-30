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
export { decodeFtTransfer, isFtTransfer } from "./ft-transfer.ts";
export { decodeNftTransfer, isNftTransfer } from "./nft-transfer.ts";
export {
	decodeStxBurn,
	decodeStxLock,
	decodeStxMint,
	decodeStxTransfer,
	isStxBurn,
	isStxLock,
	isStxMint,
	isStxTransfer,
} from "./stx-events.ts";
export {
	decodeFtBurn,
	decodeFtMint,
	decodeNftBurn,
	decodeNftMint,
	isFtBurn,
	isFtMint,
	isNftBurn,
	isNftMint,
} from "./token-mint-burn.ts";
export { decodePrint, isPrint } from "./print.ts";
import type { DecodedFtTransfer } from "./ft-transfer.ts";
import type { DecodedNftTransfer } from "./nft-transfer.ts";
import type { DecodedPrint } from "./print.ts";
import type {
	DecodedStxBurn,
	DecodedStxLock,
	DecodedStxMint,
	DecodedStxTransfer,
} from "./stx-events.ts";
import type {
	DecodedFtBurn,
	DecodedFtMint,
	DecodedNftBurn,
	DecodedNftMint,
} from "./token-mint-burn.ts";

export type DecodedEventRow =
	| DecodedFtTransfer
	| DecodedNftTransfer
	| DecodedStxTransfer
	| DecodedStxMint
	| DecodedStxBurn
	| DecodedStxLock
	| DecodedFtMint
	| DecodedFtBurn
	| DecodedNftMint
	| DecodedNftBurn
	| DecodedPrint;
export type { DecodedEventColumns } from "./_payload.ts";
export type {
	DecodedFtTransfer,
	DecodedFtTransferPayload,
	FtTransferEvent,
	FtTransferPayload,
} from "./ft-transfer.ts";
export type {
	DecodedNftTransfer,
	DecodedNftTransferPayload,
	NftTransferEvent,
	NftTransferPayload,
} from "./nft-transfer.ts";
export type {
	DecodedStxBurn,
	DecodedStxBurnPayload,
	DecodedStxLock,
	DecodedStxLockPayload,
	DecodedStxMint,
	DecodedStxMintPayload,
	DecodedStxTransfer,
	DecodedStxTransferPayload,
} from "./stx-events.ts";
export type {
	DecodedFtBurn,
	DecodedFtBurnPayload,
	DecodedFtMint,
	DecodedFtMintPayload,
	DecodedNftBurn,
	DecodedNftBurnPayload,
	DecodedNftMint,
	DecodedNftMintPayload,
} from "./token-mint-burn.ts";
export type {
	DecodedPrint,
	DecodedPrintPayload,
	DecodedPrintValue,
} from "./print.ts";
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
	StreamsEventType,
	StreamsReorg,
	StreamsReorgContext,
	StreamsReorgsListEnvelope,
	StreamsReorgsListParams,
	StreamsTip,
	StreamsUsage,
} from "./types.ts";
