import { BaseError } from "./base.ts";

export class TransactionError extends BaseError {
	override name = "TransactionError";
}

/**
 * Rejection reasons a stacks-node returns from `POST /v2/transactions`.
 * Wire strings from stacks-core `MemPoolRejection::into_json`
 * (`stackslib/src/chainstate/stacks/db/blocks.rs`).
 */
export type TxRejectionReason =
	| "Serialization"
	| "Deserialization"
	| "SignatureValidation"
	| "BadNonce"
	| "ConflictingNonceInMempool"
	| "TooMuchChaining"
	| "FeeTooLow"
	| "NotEnoughFunds"
	| "NoSuchContract"
	| "NoSuchPublicFunction"
	| "BadFunctionArgument"
	| "ContractAlreadyExists"
	| "BadTransactionVersion"
	| "TransferRecipientCannotEqualSender"
	| "TransferAmountMustBePositive"
	| "PoisonMicroblocksDoNotConflict"
	| "PoisonMicroblockHasUnknownPubKeyHash"
	| "PoisonMicroblockIsInvalid"
	| "BadAddressVersionByte"
	| "NoCoinbaseViaMempool"
	| "NoTenureChangeViaMempool"
	| "EstimatorError"
	| "TemporarilyBlacklisted"
	| "ServerFailureNoSuchChainTip"
	| "ServerFailureDatabase"
	| "ServerFailureOther";

export class BroadcastError extends BaseError {
	override name = "BroadcastError";
	txid?: string;
	// `(string & {})` keeps forward-compat with reasons newer nodes may add
	// while preserving literal-union completions.
	reason?: TxRejectionReason | (string & {});
	/** Node-provided detail; shape varies per reason (see stacks-core RPC docs). */
	reasonData?: unknown;

	constructor(
		message: string,
		options?: {
			cause?: Error;
			txid?: string;
			reason?: string;
			reasonData?: unknown;
		},
	) {
		super(message, options);
		this.txid = options?.txid;
		this.reason = options?.reason;
		this.reasonData = options?.reasonData;
	}
}

/** The transaction was mined but its execution aborted (runtime error or failed post-condition). */
export class TransactionAbortedError extends BaseError {
	override name = "TransactionAbortedError";
	/** The abort receipt (status, block info, raw source response). */
	receipt: unknown;

	constructor(message: string, options: { receipt: unknown; cause?: Error }) {
		super(message, options);
		this.receipt = options.receipt;
	}
}

/** The transaction left the mempool without being mined (dropped/replaced). */
export class TransactionDroppedError extends BaseError {
	override name = "TransactionDroppedError";
	txid: string;

	constructor(message: string, options: { txid: string; cause?: Error }) {
		super(message, options);
		this.txid = options.txid;
	}
}

/** waitForTransactionReceipt gave up before the tx reached the requested state. */
export class WaitForTransactionTimeoutError extends BaseError {
	override name = "WaitForTransactionTimeoutError";
	txid: string;

	constructor(message: string, options: { txid: string; cause?: Error }) {
		super(message, options);
		this.txid = options.txid;
	}
}

export class SerializationError extends BaseError {
	override name = "SerializationError";
}

export class SigningError extends BaseError {
	override name = "SigningError";
}
