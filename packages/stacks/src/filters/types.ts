import type { AbiContract } from "../clarity/abi/contract.ts";
import type { ChainEventFilterType, DecodedEventType } from "./event-types.ts";

// ── Canonical filter specs ───────────────────────────────────────────────
// One spelling of a chain-event filter, projected to each surface's wire
// shape by the methods on `ChainEventFilter`. Amounts are ALWAYS `bigint`
// here; `toChainTrigger()` converts to string at the JSON boundary — the
// single place that conversion happens, so it cannot be bypassed by
// structural spread.

/** Print field-schema vocabulary (structural mirror of the subgraphs
 *  `ColumnType`; kept literal so `toSubgraphSource()` preserves narrowing). */
export type PrintFieldType =
	| "uint"
	| "int"
	| "text"
	| "principal"
	| "boolean"
	| "timestamp"
	| "jsonb";

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
	assetIdentifier?: string;
	sender?: string;
	recipient?: string;
	minAmount?: bigint;
}
export interface FtMintSpec extends TraitScope {
	type: "ft_mint";
	assetIdentifier?: string;
	recipient?: string;
	minAmount?: bigint;
}
export interface FtBurnSpec extends TraitScope {
	type: "ft_burn";
	assetIdentifier?: string;
	sender?: string;
	minAmount?: bigint;
}
export interface NftTransferSpec extends TraitScope {
	type: "nft_transfer";
	assetIdentifier?: string;
	sender?: string;
	recipient?: string;
}
export interface NftMintSpec extends TraitScope {
	type: "nft_mint";
	assetIdentifier?: string;
	recipient?: string;
}
export interface NftBurnSpec extends TraitScope {
	type: "nft_burn";
	assetIdentifier?: string;
	sender?: string;
}

export interface ContractCallSpec extends TraitScope {
	type: "contract_call";
	contractId?: string;
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
	contractId?: string;
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

// ── Projection output shapes ─────────────────────────────────────────────

/** Wire shape of a chain trigger (Subscriptions), derived per member from
 *  the spec: same fields, with `bigint` amounts stringified (uint128 exceeds
 *  JS safe integers) and the type-only `abi`/`prints` decorations dropped.
 *  Structurally assignable to the SDK's `ChainTrigger` union. */
export type ChainTriggerOf<S> = {
	[K in keyof Omit<S, "abi" | "prints">]: S[K] extends bigint | undefined
		? Exclude<S[K], bigint> | string
		: S[K];
};

/** Loose trigger shape (any member). */
export type ChainTriggerShape = ChainTriggerOf<ChainEventFilterSpec>;

/** Params fragment for `index.events.*` (spread into list/walk/consume). */
export type IndexEventsParamsShape = {
	eventType: DecodedEventType;
	contractId?: string;
	assetIdentifier?: string;
	sender?: string;
	recipient?: string;
	trait?: string;
};

/** Params fragment for `index.contractCalls.*`. */
export type ContractCallsParamsShape = {
	contractId?: string;
	functionName?: string;
	sender?: string;
	trait?: string;
};

/** Params fragment for `streams.events.*`. */
export type StreamsParamsShape = {
	types: readonly DecodedEventType[];
	contractId?: string;
	sender?: string;
	recipient?: string;
	assetIdentifier?: string;
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
