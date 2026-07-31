import type { AbiContract } from "../clarity/abi/contract.ts";
import type { ChainEventFilterType, DecodedEventType } from "./event-types.ts";
import type { AssetIdentifier } from "./validate.ts";

// ── Canonical filter specs ───────────────────────────────────────────────
// One spelling of a chain-event filter, projected to each surface's wire
// shape by the methods on `ChainEventFilter`. Amounts are ALWAYS `bigint`
// here; `toChainTrigger()` converts to string at the JSON boundary — the
// single place that conversion happens, so it cannot be bypassed by
// structural spread.

/** Scalar print field types (structural mirror of the subgraphs `ColumnType`). */
export type PrintScalarType =
	| "uint"
	| "int"
	| "text"
	| "principal"
	| "boolean"
	| "timestamp"
	| "jsonb";

/**
 * One declared print field — structural mirror of `PrintField` in
 * `@secondlayer/subgraphs`. Composite forms exist because real print payloads
 * nest: a vocabulary that could only say `"jsonb"` is what let a flat-field
 * declaration type-check while every event decoded to null.
 *
 * Kept literal through `toSubgraphSource()` so handler narrowing survives.
 */
export type PrintFieldType =
	| PrintScalarType
	| { type: PrintFieldType; optional: true }
	| { tuple: Record<string, PrintFieldType> }
	| { list: PrintFieldType };

export interface StxTransferSpec {
	type: "stx_transfer";
	sender?: string;
	recipient?: string;
	minAmount?: bigint;
	maxAmount?: bigint;
}
export interface StxMintSpec {
	type: "stx_mint";
	recipient?: string;
	minAmount?: bigint;
}
export interface StxBurnSpec {
	type: "stx_burn";
	sender?: string;
	minAmount?: bigint;
}
export interface StxLockSpec {
	type: "stx_lock";
	lockedAddress?: string;
	minAmount?: bigint;
}

/** Scope to contracts conforming to a trait/standard (e.g. "sip-010") instead
 *  of a fixed contract. Index + Subgraphs + Subscriptions; Streams has no
 *  trait resolution — `toStreamsParams()` throws if set. */
type TraitScope = { trait?: string };

export interface FtTransferSpec extends TraitScope {
	type: "ft_transfer";
	assetIdentifier?: AssetIdentifier;
	sender?: string;
	recipient?: string;
	minAmount?: bigint;
}
export interface FtMintSpec extends TraitScope {
	type: "ft_mint";
	assetIdentifier?: AssetIdentifier;
	recipient?: string;
	minAmount?: bigint;
}
export interface FtBurnSpec extends TraitScope {
	type: "ft_burn";
	assetIdentifier?: AssetIdentifier;
	sender?: string;
	minAmount?: bigint;
}
export interface NftTransferSpec extends TraitScope {
	type: "nft_transfer";
	assetIdentifier?: AssetIdentifier;
	sender?: string;
	recipient?: string;
}
export interface NftMintSpec extends TraitScope {
	type: "nft_mint";
	assetIdentifier?: AssetIdentifier;
	recipient?: string;
}
export interface NftBurnSpec extends TraitScope {
	type: "nft_burn";
	assetIdentifier?: AssetIdentifier;
	sender?: string;
}

export interface ContractCallSpec extends TraitScope {
	type: "contract_call";
	/** One contract id, or a set of them (max 20). Mirrors the subgraphs
	 *  filter — a router plus its pools is one source, not N. */
	contractId?: string | readonly string[];
	functionName?: string;
	caller?: string;
	/** Contract ABI (`as const`) — preserved literally so `toSubgraphSource()`
	 *  keeps typing `event.input` in `defineSubgraph`. */
	abi?: AbiContract;
}
export interface ContractDeploySpec {
	type: "contract_deploy";
	deployer?: string;
	contractName?: string;
}
export interface PrintEventSpec extends TraitScope {
	type: "print_event";
	/** One contract id, or a set of them (max 20). */
	contractId?: string | readonly string[];
	topic?: string;
	/** Per-topic field schema — preserved literally so `toSubgraphSource()`
	 *  keeps the discriminated-union narrowing of `event.data`. */
	prints?: Record<string, Record<string, PrintFieldType>>;
}

export interface SbtcDepositSpec {
	type: "sbtc_deposit";
	sender?: string;
	minAmount?: bigint;
	maxAmount?: bigint;
	bitcoinTxid?: string;
	requestId?: number;
}
export interface SbtcWithdrawalCreateSpec {
	type: "sbtc_withdrawal_create";
	sender?: string;
	minAmount?: bigint;
	maxAmount?: bigint;
	requestId?: number;
}
export interface SbtcWithdrawalAcceptSpec {
	type: "sbtc_withdrawal_accept";
	requestId?: number;
	sweepTxid?: string;
}
export interface SbtcWithdrawalRejectSpec {
	type: "sbtc_withdrawal_reject";
	requestId?: number;
}
export interface SbtcWithdrawalSweptConfirmedSpec {
	type: "sbtc_withdrawal_swept_confirmed";
	requestId?: number;
	sweepTxid?: string;
}

export type ChainEventFilterSpec =
	| StxTransferSpec
	| StxMintSpec
	| StxBurnSpec
	| StxLockSpec
	| FtTransferSpec
	| FtMintSpec
	| FtBurnSpec
	| NftTransferSpec
	| NftMintSpec
	| NftBurnSpec
	| ContractCallSpec
	| ContractDeploySpec
	| PrintEventSpec
	| SbtcDepositSpec
	| SbtcWithdrawalCreateSpec
	| SbtcWithdrawalAcceptSpec
	| SbtcWithdrawalRejectSpec
	| SbtcWithdrawalSweptConfirmedSpec;

export type SpecFor<T extends ChainEventFilterType> = Extract<
	ChainEventFilterSpec,
	{ type: T }
>;

/** The members expressible as subgraph sources (everything but the
 *  Subscriptions-only sBTC lifecycle types). Instantiating
 *  `ChainEventFilter<SubgraphMemberType>` keeps `toSubgraphSource` present:
 *  the conditional in `ProjectionsFor` evaluates over this whole union
 *  (non-distributive at an instantiated site), and every member qualifies. */
export type SubgraphMemberType = Exclude<
	ChainEventFilterType,
	`sbtc_${string}`
>;

/** A subgraph-source-shaped filter object (the `toSubgraphSource()` output /
 *  `fromSubgraphSource()` input). */
export type SubgraphSourceSpec = Extract<
	ChainEventFilterSpec,
	{ type: SubgraphMemberType }
>;

// ── Projection output shapes ─────────────────────────────────────────────

/** Wire shape of a chain trigger (Subscriptions), derived per member from
 *  the spec: same fields, with `bigint` amounts stringified (uint128 exceeds
 *  JS safe integers) and the type-only `abi`/`prints` decorations dropped.
 *  Structurally assignable to the SDK's `ChainTrigger` union. */
export type ChainTriggerOf<S> = {
	// bigint amounts stringify at the JSON boundary; a contract SET is not
	// expressible (the wire takes ONE contract per trigger, and
	// `toChainTrigger()` throws rather than silently taking the first).
	[K in keyof Omit<S, "abi" | "prints">]:
		| Exclude<S[K], bigint | readonly string[]>
		// A bigint amount arrives as a decimal string; `bigint extends S[K]`
		// (not the reverse) so it still fires for `bigint | undefined`.
		| (bigint extends S[K] ? string : never);
};

/** Loose trigger shape (any member). */
export type ChainTriggerShape = ChainTriggerOf<ChainEventFilterSpec>;

/** Params fragment for `index.events.*` (spread into list/walk/consume). */
export type IndexEventsParamsShape = {
	eventType: DecodedEventType;
	/** A spec's contract set passes through verbatim (the API takes up to 20). */
	contractId?: string | readonly string[];
	assetIdentifier?: AssetIdentifier;
	sender?: string;
	recipient?: string;
	trait?: string;
};

/** Params fragment for `index.contractCalls.*`. */
export type ContractCallsParamsShape = {
	/** A spec's contract set passes through verbatim (the API takes up to 20). */
	contractId?: string | readonly string[];
	functionName?: string;
	/** Populated from the spec's `caller` — the endpoint filters by tx sender,
	 *  which is the caller. */
	sender?: string;
	trait?: string;
};

/** Params fragment for `streams.events.*`. */
export type StreamsParamsShape = {
	types: readonly DecodedEventType[];
	contractId?: string | readonly string[];
	sender?: string;
	recipient?: string;
	assetIdentifier?: AssetIdentifier;
};

// ── Member → projection capability ───────────────────────────────────────
// A surface a member doesn't reach is a MISSING METHOD, not a runtime error:
// "Property 'toIndexParams' does not exist" beats "argument of type never".
//
// Reality being encoded:
// - Index `events.*` and Streams cover exactly the 11 DECODED_EVENT_TYPES
//   (spelled `print`, projected from the canonical `print_event`).
// - `contract_call` reads live on the separate `/v1/index/contract-calls`
//   endpoint → `toContractCallsParams()`, not `toIndexParams()`.
// - `contract_deploy` is Subgraphs + Subscriptions only.
// - The five `sbtc_*` lifecycle types are Subscriptions-only.

type DecodedMember =
	| "stx_transfer"
	| "stx_mint"
	| "stx_burn"
	| "stx_lock"
	| "ft_transfer"
	| "ft_mint"
	| "ft_burn"
	| "nft_transfer"
	| "nft_mint"
	| "nft_burn"
	| "print_event";

export type ProjectionsFor<T extends ChainEventFilterType, S> = {
	/** Wire trigger for `subscriptions.create({ triggers: [...] })`. BigInt
	 *  amounts become strings here — the one sanctioned boundary. */
	toChainTrigger(): ChainTriggerOf<S>;
} & (T extends DecodedMember
	? {
			/** Params for `index.events.list/walk/consume` (merge your own
			 *  `limit`/`fromHeight`/`txContext` etc. on top). */
			toIndexParams<Extra extends Record<string, unknown>>(
				extra?: Extra,
			): IndexEventsParamsShape & Extra;
			/** Params for `streams.events.list/consume/stream`. Throws if the
			 *  filter uses `trait` (Streams has no trait resolution) or a
			 *  min/max amount (Streams filters have no amount predicates). */
			toStreamsParams<Extra extends Record<string, unknown>>(
				extra?: Extra,
			): StreamsParamsShape & Extra;
		}
	: // biome-ignore lint/complexity/noBannedTypes: intersection identity
		{}) &
	(T extends "contract_call"
		? {
				/** Params for `index.contractCalls.list/walk/consume`. */
				toContractCallsParams<Extra extends Record<string, unknown>>(
					extra?: Extra,
				): ContractCallsParamsShape & Extra;
			}
		: // biome-ignore lint/complexity/noBannedTypes: intersection identity
			{}) &
	(T extends Exclude<ChainEventFilterType, `sbtc_${string}`>
		? {
				/** The `sources` entry for `defineSubgraph` — literal `prints`/`abi`
				 *  types are preserved, so handler narrowing survives. */
				toSubgraphSource(): S;
			}
		: // biome-ignore lint/complexity/noBannedTypes: intersection identity
			{});

/**
 * A canonical chain-event filter: the spec fields plus the projections its
 * member supports. Write the filter once; project it to a query
 * (`toIndexParams`), a stream (`toStreamsParams`), a webhook trigger
 * (`toChainTrigger`), or a subgraph source (`toSubgraphSource`).
 */
export type ChainEventFilter<
	T extends ChainEventFilterType = ChainEventFilterType,
	S extends { type: T } = SpecFor<T>,
> = S & ProjectionsFor<T, S>;
