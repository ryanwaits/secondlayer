/**
 * `@secondlayer/shared/streams-rows` — the raw Streams event primitives
 * (`StreamsEvent`, payload types) plus the per-type guard + decode pairs that
 * produce **database row** shapes (`decoded_payload` nested, `source_cursor`
 * carried), as opposed to the flat API rows the SDK's `decode()` returns.
 *
 * Canonical home for what our own indexer/decoder consumes; the SDK re-exports
 * this surface unchanged (root types + `@secondlayer/sdk/streams/rows`).
 *
 * If you are writing a consumer against the public API, you almost certainly
 * want the SDK instead: `decode(event)` for one call returning the same flat,
 * `event_type`-discriminated row Index serves, or `decoded: true` on
 * `streams.events.consume` so decoding never appears in your handler at all.
 */
export { decodeClarityValue, toJsonSafe } from "./clarity.ts";
export type {
	FtBurnPayload,
	FtMintPayload,
	FtTransferPayload,
	NftBurnPayload,
	NftMintPayload,
	NftTransferPayload,
	PrintPayload,
	StreamsClarityValue,
	StreamsEvent,
	StreamsEventBase,
	StreamsEventPayload,
	StreamsEventType,
	StxBurnPayload,
	StxLockPayload,
	StxMintPayload,
	StxTransferPayload,
} from "./events.ts";
export { STREAMS_EVENT_TYPES } from "./events.ts";
export {
	decodedRow,
	optionalString,
	parseAssetIdentifier,
	requireAmount,
	requireAmountField,
	requireHexValue,
	requireString,
} from "./_payload.ts";
export type { DecodedEventColumns } from "./_payload.ts";
export { decodeFtTransfer, isFtTransfer } from "./ft-transfer.ts";
export { decodeNftTransfer, isNftTransfer } from "./nft-transfer.ts";
export { decodePrint, isPrint } from "./print.ts";
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

/** Union of every decoded DB-row shape the guard+decode pairs produce —
 *  exactly what the `decoded_events` table stores. */
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

export type {
	DecodedFtTransfer,
	DecodedFtTransferPayload,
	FtTransferEvent,
} from "./ft-transfer.ts";
export type {
	DecodedNftTransfer,
	DecodedNftTransferPayload,
	NftTransferEvent,
} from "./nft-transfer.ts";
export type {
	DecodedPrint,
	DecodedPrintPayload,
	DecodedPrintValue,
} from "./print.ts";
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
