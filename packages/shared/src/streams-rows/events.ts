// The raw Streams event shape + payload vocabulary. Canonical home for the
// event primitives shared by the SDK's Streams surface and the indexer's
// decoders — the SDK re-exports these unchanged (`StreamsEvent`,
// `StreamsEventType`, payload types), so the public API is unmoved.
import type { StreamsEventType } from "../event-types.ts";

export { STREAMS_EVENT_TYPES, type StreamsEventType } from "../event-types.ts";

/** A Clarity value as Streams serves it: the canonical hex string, a typed
 *  object carrying that hex (`{ hex }`), or a decoded Clarity-JSON object.
 *  Decode helpers (`decodeNftTransfer`, etc.) resolve it to a concrete value. */
export type StreamsClarityValue =
	| string
	| { hex: string }
	| Record<string, unknown>;

export type StxTransferPayload = {
	sender: string;
	recipient: string;
	amount: string;
	memo?: string;
};
export type StxMintPayload = { recipient: string; amount: string };
export type StxBurnPayload = { sender: string; amount: string };
export type StxLockPayload = {
	locked_address: string;
	locked_amount: string;
	unlock_height: string;
};
export type FtTransferPayload = {
	asset_identifier: string;
	sender: string;
	recipient: string;
	amount: string;
};
export type FtMintPayload = {
	asset_identifier: string;
	recipient: string;
	amount: string;
};
export type FtBurnPayload = {
	asset_identifier: string;
	sender: string;
	amount: string;
};
export type NftTransferPayload = {
	asset_identifier: string;
	sender: string;
	recipient: string;
	value: StreamsClarityValue;
	/** Canonical serialized hex of `value`, when the stream carries it. */
	raw_value?: string;
};
export type NftMintPayload = {
	asset_identifier: string;
	recipient: string;
	value: StreamsClarityValue;
	raw_value?: string;
};
export type NftBurnPayload = {
	asset_identifier: string;
	sender: string;
	value: StreamsClarityValue;
	raw_value?: string;
};
export type PrintPayload = {
	contract_id?: string | null;
	topic?: string;
	value?: unknown;
	raw_value?: string;
};

/** Union of every Streams payload shape, discriminated by `event_type` on the
 *  parent `StreamsEvent`. */
export type StreamsEventPayload =
	| StxTransferPayload
	| StxMintPayload
	| StxBurnPayload
	| StxLockPayload
	| FtTransferPayload
	| FtMintPayload
	| FtBurnPayload
	| NftTransferPayload
	| NftMintPayload
	| NftBurnPayload
	| PrintPayload;

export type StreamsEventBase = {
	/**
	 * Globally unique, monotonic position of this event (`<block>:<index>`). Use
	 * it as the primary key of your projection rows — replaying a batch then
	 * upserts cleanly. Don't synthesize your own id from `tx_id`/`event_index`.
	 */
	cursor: string;
	block_height: number;
	block_hash: string;
	burn_block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	contract_id: string | null;
	ts: string;
	/**
	 * True when this event's block is past the finality boundary (immutable).
	 * Optional for back-compat; the API always sets it on Streams responses.
	 */
	finalized?: boolean;
	/**
	 * Labels whose filter group this event satisfied, present only when the
	 * request used a labelled `filters` map. The SDK dispatches on it for you
	 * (`on.<label>`), so handlers rarely read it directly.
	 */
	matched?: string[];
};

type StreamsEventOf<T extends StreamsEventType, P> = StreamsEventBase & {
	event_type: T;
	payload: P;
};

/** A raw Streams event. Discriminated on `event_type`, so `event.payload`
 *  narrows to the matching payload shape once the type is checked. */
export type StreamsEvent =
	| StreamsEventOf<"stx_transfer", StxTransferPayload>
	| StreamsEventOf<"stx_mint", StxMintPayload>
	| StreamsEventOf<"stx_burn", StxBurnPayload>
	| StreamsEventOf<"stx_lock", StxLockPayload>
	| StreamsEventOf<"ft_transfer", FtTransferPayload>
	| StreamsEventOf<"ft_mint", FtMintPayload>
	| StreamsEventOf<"ft_burn", FtBurnPayload>
	| StreamsEventOf<"nft_transfer", NftTransferPayload>
	| StreamsEventOf<"nft_mint", NftMintPayload>
	| StreamsEventOf<"nft_burn", NftBurnPayload>
	| StreamsEventOf<"print", PrintPayload>;
