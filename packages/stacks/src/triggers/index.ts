/**
 * Typed event-trigger helpers for workflows.
 *
 *   import { defineWorkflow } from "@secondlayer/workflows"
 *   import { on } from "@secondlayer/stacks/triggers"
 *
 *   export default defineWorkflow({
 *     name: "whale-alert",
 *     trigger: on.stxTransfer({ minAmount: 100_000_000_000n }),
 *     handler: async ({ event, step }) => {
 *       // event is StxTransferEvent — sender, recipient, amount, tx all typed
 *     },
 *   })
 *
 * Each helper returns a standard `EventTrigger` (what the runner consumes)
 * plus a phantom `__event` type that `defineWorkflow` reads via conditional
 * type inference. The phantom carries no runtime value.
 */

import type {
	ContractCallFilter,
	ContractDeployFilter,
	FtBurnFilter,
	FtMintFilter,
	FtTransferFilter,
	NftBurnFilter,
	NftMintFilter,
	NftTransferFilter,
	PrintEventFilter,
	StxBurnFilter,
	StxLockFilter,
	StxMintFilter,
	StxTransferFilter,
} from "@secondlayer/subgraphs/types";
import type { EventTrigger } from "@secondlayer/workflows/types";

// --- Per-filter event payload shapes ---

/** Metadata shared by every event. */
export interface TxMeta {
	txId: string;
	sender: string;
	blockHeight: number;
	blockTime: number;
}

export interface StxTransferEvent {
	sender: string;
	recipient: string;
	amount: bigint;
	memo: string | null;
	tx: TxMeta;
}

export interface StxMintEvent {
	recipient: string;
	amount: bigint;
	tx: TxMeta;
}

export interface StxBurnEvent {
	sender: string;
	amount: bigint;
	tx: TxMeta;
}

export interface StxLockEvent {
	lockedAddress: string;
	amount: bigint;
	unlockHeight: number;
	tx: TxMeta;
}

export interface FtTransferEvent {
	assetIdentifier: string;
	sender: string;
	recipient: string;
	amount: bigint;
	tx: TxMeta;
}

export interface FtMintEvent {
	assetIdentifier: string;
	recipient: string;
	amount: bigint;
	tx: TxMeta;
}

export interface FtBurnEvent {
	assetIdentifier: string;
	sender: string;
	amount: bigint;
	tx: TxMeta;
}

export interface NftTransferEvent {
	assetIdentifier: string;
	sender: string;
	recipient: string;
	tokenId: string;
	tx: TxMeta;
}

export interface NftMintEvent {
	assetIdentifier: string;
	recipient: string;
	tokenId: string;
	tx: TxMeta;
}

export interface NftBurnEvent {
	assetIdentifier: string;
	sender: string;
	tokenId: string;
	tx: TxMeta;
}

export interface ContractCallEvent {
	contractId: string;
	functionName: string;
	args: unknown[];
	caller: string;
	tx: TxMeta;
}

export interface ContractDeployEvent {
	contractId: string;
	deployer: string;
	contractName: string;
	tx: TxMeta;
}

export interface PrintEventEvent {
	contractId: string;
	topic: string | null;
	value: unknown;
	tx: TxMeta;
}

// --- Typed trigger wrapper ---

/**
 * Phantom-typed EventTrigger. Runtime shape is identical to `EventTrigger`;
 * the `__event` field only exists at the type level for `defineWorkflow`
 * to infer the handler's `event` parameter.
 */
export type TypedEventTrigger<TEvent> = EventTrigger & {
	readonly __event?: TEvent;
};

function make<TEvent>(
	filter: EventTrigger["filter"],
): TypedEventTrigger<TEvent> {
	return { type: "event", filter };
}

// --- `on.*` helpers, 13 total ---

export const on = {
	stxTransfer: (f: Omit<StxTransferFilter, "type"> = {}) =>
		make<StxTransferEvent>({ type: "stx_transfer", ...f }),

	stxMint: (f: Omit<StxMintFilter, "type"> = {}) =>
		make<StxMintEvent>({ type: "stx_mint", ...f }),

	stxBurn: (f: Omit<StxBurnFilter, "type"> = {}) =>
		make<StxBurnEvent>({ type: "stx_burn", ...f }),

	stxLock: (f: Omit<StxLockFilter, "type"> = {}) =>
		make<StxLockEvent>({ type: "stx_lock", ...f }),

	ftTransfer: (f: Omit<FtTransferFilter, "type"> = {}) =>
		make<FtTransferEvent>({ type: "ft_transfer", ...f }),

	ftMint: (f: Omit<FtMintFilter, "type"> = {}) =>
		make<FtMintEvent>({ type: "ft_mint", ...f }),

	ftBurn: (f: Omit<FtBurnFilter, "type"> = {}) =>
		make<FtBurnEvent>({ type: "ft_burn", ...f }),

	nftTransfer: (f: Omit<NftTransferFilter, "type"> = {}) =>
		make<NftTransferEvent>({ type: "nft_transfer", ...f }),

	nftMint: (f: Omit<NftMintFilter, "type"> = {}) =>
		make<NftMintEvent>({ type: "nft_mint", ...f }),

	nftBurn: (f: Omit<NftBurnFilter, "type"> = {}) =>
		make<NftBurnEvent>({ type: "nft_burn", ...f }),

	contractCall: (f: Omit<ContractCallFilter, "type"> = {}) =>
		make<ContractCallEvent>({ type: "contract_call", ...f }),

	contractDeploy: (f: Omit<ContractDeployFilter, "type"> = {}) =>
		make<ContractDeployEvent>({ type: "contract_deploy", ...f }),

	printEvent: (f: Omit<PrintEventFilter, "type"> = {}) =>
		make<PrintEventEvent>({ type: "print_event", ...f }),
} as const;

/** Extract the event payload type from a trigger. */
export type EventOf<T> = T extends TypedEventTrigger<infer E> ? E : never;
