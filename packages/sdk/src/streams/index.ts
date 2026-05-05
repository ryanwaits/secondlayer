export { createStreamsClient } from "./client.ts";
export {
	AuthError,
	RateLimitError,
	StreamsServerError,
	ValidationError,
} from "./errors.ts";
export { decodeFtTransfer, isFtTransfer } from "./ft-transfer.ts";
export { decodeNftTransfer, isNftTransfer } from "./nft-transfer.ts";
import type { DecodedFtTransfer } from "./ft-transfer.ts";
import type { DecodedNftTransfer } from "./nft-transfer.ts";

export type DecodedEventRow = DecodedFtTransfer | DecodedNftTransfer;
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
export { STREAMS_EVENT_TYPES } from "./types.ts";
export type {
	FetchLike,
	StreamsClient,
	StreamsCanonicalBlock,
	StreamsEvent,
	StreamsEventPayload,
	StreamsEventsConsumeParams,
	StreamsEventsConsumeResult,
	StreamsEventsEnvelope,
	StreamsEventsListEnvelope,
	StreamsEventsListParams,
	StreamsEventsStreamParams,
	StreamsEventType,
	StreamsReorg,
	StreamsReorgsListEnvelope,
	StreamsReorgsListParams,
	StreamsTip,
} from "./types.ts";
