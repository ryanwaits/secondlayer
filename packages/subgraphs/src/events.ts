/**
 * Typed event payloads passed to subgraph handlers, one per source `type`.
 *
 * Each interface mirrors exactly what the runtime builds in
 * `runtime/runner.ts` `buildEventPayload`. `EventForFilter` maps a source
 * filter to its payload so handlers are typed by their source's `type` (no
 * `event as {...}` casts).
 */
import type { ContractCallEvent, SubgraphFilter, TxMeta } from "./types.ts";

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

// ── Filter → payload mapping ─────────────────────────────────────────────

/** The event payload a handler receives for a given source filter. */
export type EventForFilter<F extends SubgraphFilter> = F extends {
	type: "print_event";
}
	? PrintEventPayload
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
												? ContractCallEvent
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
