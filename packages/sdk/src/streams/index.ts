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
// @deprecated (whole block): these 22 helpers are an internal decoder API
// that shipped as public DX — they return DB-row shapes (`decoded_payload`
// nested, `source_cursor`) and force an 11-branch guard+decode dispatch.
// Use `decode(event)` (one call, the same flat `event_type`-discriminated
// row Index serves) or `decoded: true` on `streams.events.consume`. These
// exports will be removed in the next major.
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
