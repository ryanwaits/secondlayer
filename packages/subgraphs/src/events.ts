/**
 * Typed event payloads passed to subgraph handlers, one per source `type`.
 *
 * Each interface mirrors exactly what the runtime builds in
 * `runtime/runner.ts` `buildEventPayload`. `EventForFilter` maps a source
 * filter to its payload so handlers are typed by their source's `type` (no
 * `event as {...}` casts).
 */
import type {
	AbiContract,
	ExtractFunctionArgs,
	ExtractFunctionNames,
} from "@secondlayer/stacks/clarity";
import type { ColumnToTS } from "./infer.ts";
import type {
	ColumnType,
	ContractCallEvent,
	PrintField,
	SubgraphFilter,
	TxMeta,
} from "./types.ts";

// ── FT events ────────────────────────────────────────────────────────────

export interface FtTransferPayload {
	sender: string;
	recipient: string;
	amount: bigint;
	assetIdentifier: string;
	tx: TxMeta;
}
export interface FtMintPayload {
	recipient: string;
	amount: bigint;
	assetIdentifier: string;
	tx: TxMeta;
}
export interface FtBurnPayload {
	sender: string;
	amount: bigint;
	assetIdentifier: string;
	tx: TxMeta;
}

// ── NFT events ───────────────────────────────────────────────────────────
// `tokenId` is the decoded Clarity value as-is — its shape depends on the
// asset, so it stays `unknown` (narrow it in the handler).

export interface NftTransferPayload {
	sender: string;
	recipient: string;
	tokenId: unknown;
	assetIdentifier: string;
	tx: TxMeta;
}
export interface NftMintPayload {
	recipient: string;
	tokenId: unknown;
	assetIdentifier: string;
	tx: TxMeta;
}
export interface NftBurnPayload {
	sender: string;
	tokenId: unknown;
	assetIdentifier: string;
	tx: TxMeta;
}

// ── STX events ───────────────────────────────────────────────────────────

export interface StxTransferPayload {
	sender: string;
	recipient: string;
	amount: bigint;
	/** Memo string, or "" when none was attached. */
	memo: string;
	tx: TxMeta;
}
export interface StxMintPayload {
	recipient: string;
	amount: bigint;
	tx: TxMeta;
}
export interface StxBurnPayload {
	sender: string;
	amount: bigint;
	tx: TxMeta;
}
export interface StxLockPayload {
	lockedAddress: string;
	lockedAmount: bigint;
	unlockHeight: bigint;
	tx: TxMeta;
}

// ── Print event ──────────────────────────────────────────────────────────

export interface PrintEventPayload {
	contractId: string;
	/** Decoded print topic (the Clarity tuple's `topic` field), or "". */
	topic: string;
	/**
	 * Remaining decoded tuple fields, camelCased. Empty object when the print
	 * value isn't a tuple. Narrow per `topic` to access typed fields.
	 */
	data: Record<string, unknown>;
	tx: TxMeta;
}

// ── Contract deploy ──────────────────────────────────────────────────────

export interface ContractDeployPayload {
	contractId: string;
	deployer: string;
	tx: TxMeta;
}

// ── Contract call ────────────────────────────────────────────────────────

/**
 * Contract-call payload. When the source carries a `const` `abi` and a known
 * `functionName`, `event.input` is the named, typed, decoded arguments
 * (camelCased, via the contract ABI). The positional `event.args` is always
 * present for back-compat. Without an `abi`, the payload is {@link ContractCallEvent}.
 */
export type ContractCallPayload<F> = F extends {
	abi: infer A extends AbiContract;
	functionName: infer N extends string;
}
	? N extends ExtractFunctionNames<A>
		? ContractCallEvent & { input: ExtractFunctionArgs<A, N> }
		: ContractCallEvent
	: ContractCallEvent;

// ── Filter → payload mapping ─────────────────────────────────────────────

/**
 * Print event typed per topic. When a `print_event` source declares a `prints`
 * map, the payload is a discriminated union keyed by `topic` with `data` typed
 * per topic; otherwise it falls back to the untyped {@link PrintEventPayload}.
 */
export type PrintEventFor<F> = F extends {
	prints: infer P extends Record<string, Record<string, PrintField>>;
}
	? {
			[K in keyof P]: {
				contractId: string;
				topic: K;
				data: PrintDataOf<P[K]>;
				tx: TxMeta;
			};
		}[keyof P]
	: PrintEventPayload;

/** TS type of one declared print field (nested tuples and lists included). */
export type PrintFieldToTS<F> = F extends ColumnType
	? ColumnToTS<F>
	: F extends { type: infer Inner; optional: true }
		? PrintFieldToTS<Inner>
		: F extends { tuple: infer T extends Record<string, PrintField> }
			? PrintDataOf<T>
			: F extends { list: infer Item }
				? PrintFieldToTS<Item>[]
				: unknown;

type OptionalFieldKeys<T> = {
	[K in keyof T]: T[K] extends { optional: true } ? K : never;
}[keyof T];

/** Collapse an intersection into one object literal, so hovering `event.data`
 *  shows the fields rather than `A & B`. */
type Flatten<T> = { [K in keyof T]: T[K] } & {};

/**
 * `event.data` for one topic: declared fields typed, with
 * `{ optional: true }` fields made optional KEYS (a field observed on only
 * some events must not be typed as always present).
 */
export type PrintDataOf<T extends Record<string, PrintField>> = Flatten<
	{
		[K in Exclude<keyof T, OptionalFieldKeys<T>>]: PrintFieldToTS<T[K]>;
	} & {
		[K in OptionalFieldKeys<T>]?: PrintFieldToTS<T[K]>;
	}
>;

/** The event payload a handler receives for a given source filter. */
export type EventForFilter<F extends SubgraphFilter> = F extends {
	type: "print_event";
}
	? PrintEventFor<F>
	: F extends { type: "ft_transfer" }
		? FtTransferPayload
		: F extends { type: "ft_mint" }
			? FtMintPayload
			: F extends { type: "ft_burn" }
				? FtBurnPayload
				: F extends { type: "nft_transfer" }
					? NftTransferPayload
					: F extends { type: "nft_mint" }
						? NftMintPayload
						: F extends { type: "nft_burn" }
							? NftBurnPayload
							: F extends { type: "stx_transfer" }
								? StxTransferPayload
								: F extends { type: "stx_mint" }
									? StxMintPayload
									: F extends { type: "stx_burn" }
										? StxBurnPayload
										: F extends { type: "stx_lock" }
											? StxLockPayload
											: F extends { type: "contract_call" }
												? ContractCallPayload<F>
												: F extends { type: "contract_deploy" }
													? ContractDeployPayload
													: never;

/** Union of every event payload — the `"*"` catch-all handler receives this. */
export type AnyEvent =
	| FtTransferPayload
	| FtMintPayload
	| FtBurnPayload
	| NftTransferPayload
	| NftMintPayload
	| NftBurnPayload
	| StxTransferPayload
	| StxMintPayload
	| StxBurnPayload
	| StxLockPayload
	| PrintEventPayload
	| ContractCallEvent
	| ContractDeployPayload;
