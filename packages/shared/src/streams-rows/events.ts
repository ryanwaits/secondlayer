// The raw Streams event shape + payload vocabulary. Canonical home for the
// event primitives shared by the SDK's Streams surface and the indexer's
// decoders — the SDK re-exports these unchanged (`StreamsEvent`,
// `StreamsEventType`, payload types), so the public API is unmoved.
import type {
	RuneEventType,
	StreamsEventType,
	VmEventType,
} from "../event-types.ts";

export {
	RUNE_EVENT_TYPES,
	STREAMS_EVENT_TYPES,
	type RuneEventType,
	type StreamsEventType,
} from "../event-types.ts";

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
	/**
	 * Which chain this event came from (plan 059). Every Stacks Streams
	 * response sets this to `"stacks"`; optional here for back-compat with
	 * fixtures/tests that pre-date the field — the same reasoning as
	 * `finalized?`. Cursors stay per-chain but chain-agnostic in shape, so this
	 * is the only signal a mixed-chain caller can discriminate on.
	 */
	chain?: "stacks";
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

// ── clock=vm rows (opt-in node vm_events) ─────────────────────────────────
// A parallel vocabulary, not part of `StreamsEvent`: `event_index` here is
// `ordinal`, a second ordinal that never mixes with Streams 1.0.

export type NestedContractCallPayload = {
	contract_identifier: string;
	/** tx-sender (the signer). `null` when the VM had none. */
	sender: string | null;
	/** The contract that issued `contract-call?`. */
	caller: string;
	function_name: string;
	/** Clarity hex per argument. */
	function_args: string[];
	raw_result: string;
};
export type VarSetPayload = {
	contract_identifier: string;
	var_name: string;
	raw_value: string;
};
export type MapWritePayload = {
	contract_identifier: string;
	map_name: string;
	raw_key: string;
	raw_value: string;
};
export type MapDeletePayload = {
	contract_identifier: string;
	map_name: string;
	raw_key: string;
};

type VmStreamsEventOf<T extends VmEventType, P> = StreamsEventBase & {
	event_type: T;
	payload: P;
};

/** A Streams `clock=vm` row. Same envelope as {@link StreamsEvent}; the
 *  discriminator is one of the five VM_EVENT_TYPES and `event_index` is
 *  `ordinal`. */
export type VmStreamsEvent =
	| VmStreamsEventOf<"nested_contract_call", NestedContractCallPayload>
	| VmStreamsEventOf<"var_set", VarSetPayload>
	| VmStreamsEventOf<"map_set", MapWritePayload>
	| VmStreamsEventOf<"map_insert", MapWritePayload>
	| VmStreamsEventOf<"map_delete", MapDeletePayload>;

// ── chain=bitcoin rows (Runes events, plan 059) ────────────────────────────
// `rune_*` events live in Streams alongside the Stacks rows above, selected by
// the request's `chain` param — never inside the cursor, so Stacks cursors
// stay byte-identical (`<height>:<event_index>` is chain-relative, valid only
// against the chain it was issued for). A response never mixes chains, same
// rule as `clock`.
//
// No `burn_block_height` (Bitcoin has no burn chain of its own) and no `ts`:
// the Runes Postgres (`packages/bitcoin`, D18) has no per-block wall-clock
// column — `btc_blocks` is height+hash only (see `RUNE_EVENT_TYPES`'s doc and
// `packages/bitcoin/migrations/0001_runes.ts`). Adding one is a bitcoin-package
// migration, out of this plan's scope; a future plan can add `ts` once that
// column exists.

/** The etch a `rune_etch` event created — everything a consumer needs to
 *  render a fresh rune without a second lookup, minus what the envelope
 *  already carries (`rune_id`). Mirrors 058's `RuneEntry` shape
 *  (`packages/api/src/index/runes.ts`), trimmed to fields that exist at etch
 *  time (no `mints`/`burned`/`supply` — always zero on the etching event). */
export type RuneEtchEntry = {
	/** No spacers, uppercase. */
	name: string;
	/** As etched, spacers included (e.g. `DOG•GO•TO•THE•MOON`). */
	spaced_name: string;
	symbol: string | null;
	divisibility: number;
	/** u128 decimal string. Never `Number()`. */
	premine: string;
	turbo: boolean;
	terms: {
		amount: string | null;
		cap: string | null;
		height_start: string | null;
		height_end: string | null;
		offset_start: string | null;
		offset_end: string | null;
	} | null;
};

export type RuneEventPayload = {
	/** u128 decimal string. Never `Number()`. */
	amount: string;
	/** The output this event landed on. Set on `rune_transfer` only — an etch
	 *  or mint's allocation isn't tied to one output the way a transfer is
	 *  (`packages/bitcoin/src/runes/updater.ts`). */
	vout?: number;
	/** The output's mainnet address. Set on `rune_transfer` only, and only
	 *  when the output has a standard scriptPubKey. */
	address?: string;
	/** `rune_etch` only — the entry this event created. */
	entry?: RuneEtchEntry;
};

export type RuneStreamsEvent = {
	cursor: string;
	chain: "bitcoin";
	block_height: number;
	block_hash: string;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: RuneEventType;
	rune_id: string;
	payload: RuneEventPayload;
	/** True when this event's block is past the finality boundary (immutable).
	 *  Optional for back-compat with the same reasoning as `StreamsEventBase`. */
	finalized?: boolean;
};

/** Anything `GET /v1/streams/events` can return: Streams 1.0 rows on the
 *  classic clock, vm rows on `clock=vm`, or Runes rows on `chain=bitcoin`. A
 *  response never mixes chains or clocks. */
export type StreamsWireEvent = StreamsEvent | VmStreamsEvent | RuneStreamsEvent;
