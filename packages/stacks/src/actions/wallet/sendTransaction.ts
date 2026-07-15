import type { TransactionReceipt } from "../../actions/public/txSources.ts";
import { waitForTransactionReceipt } from "../../actions/public/waitForTransactionReceipt.ts";
import type { Client } from "../../clients/types.ts";
import { BroadcastError } from "../../errors/transaction.ts";
import { getTransactionId } from "../../transactions/signer.ts";
import type { StacksTransaction } from "../../transactions/types.ts";
import { serializeTransaction } from "../../transactions/wire/serialize.ts";
import { bytesToHex } from "../../utils/encoding.ts";

export type SendTransactionParams = {
	transaction: StacksTransaction;
	attachment?: Uint8Array | string;
	/**
	 * Wait for the transaction to be mined before returning. `true` waits for
	 * 1 confirmation; a number waits for that many. The receipt lands on the
	 * result. Rejects if the tx aborts, is dropped, or the wait times out.
	 */
	wait?: boolean | number;
};

export type SendTransactionResult = {
	txid: string;
	/** Present when `wait` was requested. */
	receipt?: TransactionReceipt;
};

/** Broadcast a signed transaction to the network */
export async function sendTransaction(
	client: Client,
	params: SendTransactionParams,
): Promise<SendTransactionResult> {
	const hex = bytesToHex(serializeTransaction(params.transaction));

	const body: Record<string, string> = { tx: hex };
	if (params.attachment) {
		body.attachment =
			typeof params.attachment === "string"
				? params.attachment
				: bytesToHex(params.attachment);
	}

	const data = await client.request("/v2/transactions", {
		method: "POST",
		body,
	});

	if (data.error) {
		throw new BroadcastError(data.reason ?? data.error, {
			reason: data.reason,
			reasonData: data.reason_data,
			txid: data.txid ?? getTransactionId(params.transaction),
		});
	}

	const txid =
		typeof data === "string"
			? data.replace(/"/g, "")
			: (data.txid ?? getTransactionId(params.transaction));

	if (params.wait) {
		const confirmations = params.wait === true ? 1 : params.wait;
		const receipt = await waitForTransactionReceipt(client, {
			txid,
			confirmations,
		});
		return { txid, receipt };
	}

	return { txid };
}
