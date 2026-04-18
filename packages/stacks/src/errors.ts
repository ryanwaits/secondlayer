/**
 * Structured error classes thrown by `broadcast()` and the workflow runner's
 * broadcast step. The runner's retry policy consults `reason` (for
 * `TxRejectedError`) to decide whether to re-attempt — abort-by-post-condition
 * is non-retryable, timeouts retry with a fee bump, etc.
 */

export type TxRejectionReason =
	| "abort_by_post_condition"
	| "abort_by_response"
	| "runtime_error"
	| "out_of_gas"
	| "nonce_conflict"
	| "signature_invalid"
	| "unknown";

/**
 * Thrown when a transaction submitted to the Stacks node is rejected
 * (mempool or on-chain). Each `reason` maps to different retry semantics.
 */
export class TxRejectedError extends Error {
	override readonly name = "TxRejectedError";
	constructor(
		message: string,
		readonly reason: TxRejectionReason,
		readonly txId?: string,
	) {
		super(message);
	}

	/**
	 * Heuristic: is retrying the same tx likely to succeed?
	 * `abort_by_post_condition` / `abort_by_response` reflect on-chain state
	 * or explicit rejection — same tx will fail again.
	 */
	get isRetryable(): boolean {
		switch (this.reason) {
			case "abort_by_post_condition":
			case "abort_by_response":
			case "signature_invalid":
				return false;
			default:
				return true;
		}
	}
}

/**
 * Thrown when a broadcast was submitted (mempool accepted) but never mined
 * within the configured `confirmationTimeout`. Retryable with fee bump.
 */
export class TxTimeoutError extends Error {
	override readonly name = "TxTimeoutError";
	readonly isRetryable = true;
	constructor(
		message: string,
		readonly txId: string,
		readonly timeoutMs: number,
	) {
		super(message);
	}
}

/**
 * Thrown when the remote signer refused to sign (policy denied, quota hit,
 * bad request). Non-retryable — customer policy won't change on retry.
 */
export class TxSignerRefusedError extends Error {
	override readonly name = "TxSignerRefusedError";
	readonly isRetryable = false;
	constructor(
		message: string,
		readonly signerName: string,
		readonly reason: string,
	) {
		super(message);
	}
}
