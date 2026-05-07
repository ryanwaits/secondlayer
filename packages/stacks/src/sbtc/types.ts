import type { SbtcEventTopic } from "./constants.ts";

/**
 * Bitcoin recipient address as encoded in `withdrawal-create` events.
 * `version` is a single byte mapping to {@link SBTC_BTC_ADDRESS_VERSION};
 * `hashbytes` is the 20- or 32-byte hash payload.
 */
export type SbtcBtcRecipient = {
	version: number;
	hashbytes: Uint8Array;
};

/** `(print { topic: "completed-deposit", ... })` from `sbtc-registry`. */
export type CompletedDepositEvent = {
	topic: "completed-deposit";
	bitcoinTxid: Uint8Array;
	outputIndex: bigint;
	amount: bigint;
	burnHash: Uint8Array;
	burnHeight: bigint;
	sweepTxid: Uint8Array;
};

/** `(print { topic: "withdrawal-create", ... })`. */
export type WithdrawalCreateEvent = {
	topic: "withdrawal-create";
	requestId: bigint;
	amount: bigint;
	sender: string;
	recipient: SbtcBtcRecipient;
	blockHeight: bigint;
	maxFee: bigint;
};

/** `(print { topic: "withdrawal-accept", ... })`. */
export type WithdrawalAcceptEvent = {
	topic: "withdrawal-accept";
	requestId: bigint;
	bitcoinTxid: Uint8Array;
	signerBitmap: bigint;
	outputIndex: bigint;
	fee: bigint;
	burnHash: Uint8Array;
	burnHeight: bigint;
	sweepTxid: Uint8Array;
};

/** `(print { topic: "withdrawal-reject", ... })`. */
export type WithdrawalRejectEvent = {
	topic: "withdrawal-reject";
	requestId: bigint;
	signerBitmap: bigint;
};

/** `(print { topic: "key-rotation", ... })` — signer-set rotation. */
export type KeyRotationEvent = {
	topic: "key-rotation";
	newKeys: Uint8Array[];
	newAddress: string;
	newAggregatePubkey: Uint8Array;
	newSignatureThreshold: bigint;
};

/** `(print { topic: "update-protocol-contract", ... })` — governance hook. */
export type UpdateProtocolContractEvent = {
	topic: "update-protocol-contract";
	contractType: Uint8Array;
	newContract: string;
};

/** Discriminated union of every protocol-state event from `sbtc-registry`. */
export type SbtcRegistryEvent =
	| CompletedDepositEvent
	| WithdrawalCreateEvent
	| WithdrawalAcceptEvent
	| WithdrawalRejectEvent
	| KeyRotationEvent
	| UpdateProtocolContractEvent;

/** SIP-010 token-event flavors emitted on the sbtc-token contract. */
export type SbtcTokenEventType = "transfer" | "mint" | "burn";

export type SbtcTokenTransferEvent = {
	type: "transfer";
	sender: string;
	recipient: string;
	amount: bigint;
	memo: Uint8Array | null;
};

export type SbtcTokenMintEvent = {
	type: "mint";
	recipient: string;
	amount: bigint;
};

export type SbtcTokenBurnEvent = {
	type: "burn";
	sender: string;
	amount: bigint;
};

export type SbtcTokenEvent =
	| SbtcTokenTransferEvent
	| SbtcTokenMintEvent
	| SbtcTokenBurnEvent;

/** Helper for narrowing on `topic`. */
export type SbtcEventByTopic<T extends SbtcEventTopic> = Extract<
	SbtcRegistryEvent,
	{ topic: T }
>;
