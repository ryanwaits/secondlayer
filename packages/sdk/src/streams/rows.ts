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
 *
 * The primitives themselves live in `@secondlayer/shared/streams-rows`
 * (canonical home, shared with the indexer); this subpath re-exports them
 * unchanged.
 */
export {
	decodeFtTransfer,
	isFtTransfer,
	decodeNftTransfer,
	isNftTransfer,
	decodePrint,
	isPrint,
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
} from "@secondlayer/shared/streams-rows";

export type {
	DecodedEventColumns,
	DecodedEventRow,
	DecodedFtBurn,
	DecodedFtMint,
	DecodedFtTransfer,
	DecodedFtTransferPayload,
	DecodedNftBurn,
	DecodedNftMint,
	DecodedNftTransfer,
	DecodedNftTransferPayload,
	DecodedPrint,
	DecodedPrintPayload,
	DecodedStxBurn,
	DecodedStxLock,
	DecodedStxMint,
	DecodedStxTransfer,
} from "@secondlayer/shared/streams-rows";
