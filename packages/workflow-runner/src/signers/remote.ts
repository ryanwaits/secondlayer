import { createHmac, randomBytes } from "node:crypto";
import { logger } from "@secondlayer/shared/logger";
import { TxSignerRefusedError } from "@secondlayer/stacks";
import type { RemoteSignerConfig } from "@secondlayer/workflows";

/**
 * Wire contract sent to customer-hosted signer endpoints. Kept in sync with
 * `@secondlayer/signer-node/types` — duplicated here so the runner doesn't
 * take a runtime dependency on the reference package.
 */
export interface TxBreakdown {
	kind: "transfer" | "contract-call" | "deploy" | "multisend";
	unsignedTxHex: string;
	fee: string;
	nonce: string;
	recipient?: string;
	amount?: string;
	memo?: string;
	contract?: string;
	functionName?: string;
	argsCount?: number;
	name?: string;
	sourceSize?: number;
	paymentCount?: number;
}

export interface SignRequest {
	requestId: string;
	runId: string;
	workflow: string;
	stepId: string;
	signerName: string;
	tx: TxBreakdown;
	caps?: { maxMicroStx?: string; maxFee?: string };
	issuedAt: string;
}

interface SignResponseOk {
	ok: true;
	signedTxHex: string;
	nonce: string;
}

interface SignResponseRefused {
	ok: false;
	refused: true;
	reason: string;
}

type SignResponse = SignResponseOk | SignResponseRefused;

export interface RemoteSignOptions {
	signer: RemoteSignerConfig;
	signerName: string;
	hmacSecret: string;
	tx: TxBreakdown;
	runId: string;
	workflow: string;
	stepId: string;
	caps?: { maxMicroStx?: bigint; maxFee?: bigint };
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * POST an unsigned transaction to the remote signer, verify the response,
 * return the signed hex. Throws `TxSignerRefusedError` on policy refusal or
 * network failure — the runner's retry policy treats these as non-retryable.
 */
export async function requestSignature(
	opts: RemoteSignOptions,
): Promise<{ signedTxHex: string; nonce: string }> {
	const request: SignRequest = {
		requestId: randomBytes(16).toString("hex"),
		runId: opts.runId,
		workflow: opts.workflow,
		stepId: opts.stepId,
		signerName: opts.signerName,
		tx: opts.tx,
		caps:
			opts.caps?.maxMicroStx || opts.caps?.maxFee
				? {
						maxMicroStx: opts.caps?.maxMicroStx?.toString(),
						maxFee: opts.caps?.maxFee?.toString(),
					}
				: undefined,
		issuedAt: new Date().toISOString(),
	};

	const body = JSON.stringify(request);
	const hmac = `sha256=${createHmac("sha256", opts.hmacSecret).update(body).digest("hex")}`;

	const controller = new AbortController();
	const timeoutMs = opts.signer.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	let response: Response;
	try {
		response = await fetch(opts.signer.endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Sl-Hmac": hmac,
			},
			body,
			signal: controller.signal,
		});
	} catch (err) {
		throw new TxSignerRefusedError(
			`Remote signer network error: ${err instanceof Error ? err.message : String(err)}`,
			opts.signerName,
			"network_error",
		);
	} finally {
		clearTimeout(timer);
	}

	let parsed: SignResponse;
	try {
		parsed = (await response.json()) as SignResponse;
	} catch {
		throw new TxSignerRefusedError(
			`Remote signer returned non-JSON body (HTTP ${response.status})`,
			opts.signerName,
			"bad_response",
		);
	}

	if (!parsed.ok) {
		logger.warn("remote signer refused", {
			signer: opts.signerName,
			reason: parsed.refused ? parsed.reason : "unknown",
			status: response.status,
		});
		throw new TxSignerRefusedError(
			`Remote signer refused: ${parsed.refused ? parsed.reason : "unknown"}`,
			opts.signerName,
			parsed.refused ? parsed.reason : "unknown",
		);
	}

	return { signedTxHex: parsed.signedTxHex, nonce: parsed.nonce };
}
