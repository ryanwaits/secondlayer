/**
 * Typed event-trigger helpers. Each helper returns a standard `EventTrigger`
 * plus a phantom `__event` type used for inference at consumer sites. The
 * phantom carries no runtime value.
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
import type { EventTrigger } from "./types";

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
 * the `__event` field only exists at the type level, letting subscription
 * definitions infer the handler's `event` parameter from the filter.
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

export interface TriggerHelpers {
	stxTransfer: (
		f?: Omit<StxTransferFilter, "type">,
	) => TypedEventTrigger<StxTransferEvent>;
	stxMint: (f?: Omit<StxMintFilter, "type">) => TypedEventTrigger<StxMintEvent>;
	stxBurn: (f?: Omit<StxBurnFilter, "type">) => TypedEventTrigger<StxBurnEvent>;
	stxLock: (f?: Omit<StxLockFilter, "type">) => TypedEventTrigger<StxLockEvent>;
	ftTransfer: (
		f?: Omit<FtTransferFilter, "type">,
	) => TypedEventTrigger<FtTransferEvent>;
	ftMint: (f?: Omit<FtMintFilter, "type">) => TypedEventTrigger<FtMintEvent>;
	ftBurn: (f?: Omit<FtBurnFilter, "type">) => TypedEventTrigger<FtBurnEvent>;
	nftTransfer: (
		f?: Omit<NftTransferFilter, "type">,
	) => TypedEventTrigger<NftTransferEvent>;
	nftMint: (f?: Omit<NftMintFilter, "type">) => TypedEventTrigger<NftMintEvent>;
	nftBurn: (f?: Omit<NftBurnFilter, "type">) => TypedEventTrigger<NftBurnEvent>;
	contractCall: (
		f?: Omit<ContractCallFilter, "type">,
	) => TypedEventTrigger<ContractCallEvent>;
	contractDeploy: (
		f?: Omit<ContractDeployFilter, "type">,
	) => TypedEventTrigger<ContractDeployEvent>;
	printEvent: (
		f?: Omit<PrintEventFilter, "type">,
	) => TypedEventTrigger<PrintEventEvent>;
}

export const on: TriggerHelpers = {
	stxTransfer: (f = {}) =>
		make<StxTransferEvent>({ type: "stx_transfer", ...f }),

	stxMint: (f = {}) => make<StxMintEvent>({ type: "stx_mint", ...f }),

	stxBurn: (f = {}) => make<StxBurnEvent>({ type: "stx_burn", ...f }),

	stxLock: (f = {}) => make<StxLockEvent>({ type: "stx_lock", ...f }),

	ftTransfer: (f = {}) => make<FtTransferEvent>({ type: "ft_transfer", ...f }),

	ftMint: (f = {}) => make<FtMintEvent>({ type: "ft_mint", ...f }),

	ftBurn: (f = {}) => make<FtBurnEvent>({ type: "ft_burn", ...f }),

	nftTransfer: (f = {}) =>
		make<NftTransferEvent>({ type: "nft_transfer", ...f }),

	nftMint: (f = {}) => make<NftMintEvent>({ type: "nft_mint", ...f }),

	nftBurn: (f = {}) => make<NftBurnEvent>({ type: "nft_burn", ...f }),

	contractCall: (f = {}) =>
		make<ContractCallEvent>({ type: "contract_call", ...f }),

	contractDeploy: (f = {}) =>
		make<ContractDeployEvent>({ type: "contract_deploy", ...f }),

	printEvent: (f = {}) => make<PrintEventEvent>({ type: "print_event", ...f }),
};

/** Extract the event payload type from a trigger. */
export type EventOf<T> = T extends TypedEventTrigger<infer E> ? E : never;
