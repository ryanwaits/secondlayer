/**
 * Wire format for the Secondlayer remote-signer protocol.
 *
 * The workflow runner POSTs a `SignRequest` to the configured endpoint with
 * an HMAC-SHA256 header computed over the raw request body. The signer
 * service verifies the HMAC, applies the customer's policy, signs the tx,
 * and returns a `SignResponse`.
 */

export interface TxBreakdown {
	kind: "transfer" | "contract-call" | "deploy" | "multisend";
	/** Hex-encoded serialized StacksTransaction (unsigned). */
	unsignedTxHex: string;
	fee: string;
	nonce: string;
	/** Transfer-specific. */
	recipient?: string;
	amount?: string;
	memo?: string;
	/** Contract-call-specific. */
	contract?: string;
	functionName?: string;
	argsCount?: number;
	/** Deploy-specific. */
	name?: string;
	sourceSize?: number;
	/** Multisend-specific. */
	paymentCount?: number;
}

export interface SignRequest {
	/** Unique id for the broadcast step invocation, used for idempotency + audit. */
	requestId: string;
	/** Workflow run id (workflow_runs.id in Secondlayer DB). */
	runId: string;
	/** Workflow name. */
	workflow: string;
	/** Step id that issued the broadcast. */
	stepId: string;
	/** Named signer declared in the workflow's `signers` map. */
	signerName: string;
	/** Structured summary + the raw unsigned tx. */
	tx: TxBreakdown;
	/** Client-enforced caps the workflow author declared. */
	caps?: {
		maxMicroStx?: string;
		maxFee?: string;
	};
	/** ISO-8601 timestamp of the request (replay protection). */
	issuedAt: string;
}

export type SignResponse =
	| {
			ok: true;
			signedTxHex: string;
			nonce: string;
	  }
	| {
			ok: false;
			refused: true;
			reason: string;
	  };
