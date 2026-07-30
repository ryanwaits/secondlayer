/**
 * `@secondlayer/sdk/streams/rows` — the per-type guard + decode pairs that
 * produce **database row** shapes (`decoded_payload` nested, `source_cursor`
 * carried), as opposed to the flat API rows `decode()` returns.
 *
 * These are a lower-level API and the subpath says so: you have to reach for
 * it. Reach for it when you are building a `decoded_events`-shaped projection
 * and need the storage shape — which is what our own decoder does.
 *
 * If you are writing a consumer, you almost certainly want the root instead:
 * `decode(event)` for one call returning the same flat, `event_type`-
 * discriminated row Index serves, or `decoded: true` on
 * `streams.events.consume` so decoding never appears in your handler at all.
 * Those exist precisely so an 11-branch guard+decode dispatch is not the
 * default experience.
 */
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

export type { DecodedEventColumns } from "./_payload.ts";
export type {
	DecodedFtTransfer,
	DecodedFtTransferPayload,
} from "./ft-transfer.ts";
export type {
	DecodedNftTransfer,
	DecodedNftTransferPayload,
} from "./nft-transfer.ts";
export type { DecodedPrint, DecodedPrintPayload } from "./print.ts";
export type {
	DecodedStxBurn,
	DecodedStxLock,
	DecodedStxMint,
	DecodedStxTransfer,
} from "./stx-events.ts";
export type {
	DecodedFtBurn,
	DecodedFtMint,
	DecodedNftBurn,
	DecodedNftMint,
} from "./token-mint-burn.ts";
export type { DecodedEventRow } from "./index.ts";
