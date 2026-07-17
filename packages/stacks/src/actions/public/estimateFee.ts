import type { Client } from "../../clients/types.ts";
import { MalformedResponseError } from "../../errors/response.ts";
import type { StacksTransaction } from "../../transactions/types.ts";
import {
	serializePayload,
	serializeTransaction,
} from "../../transactions/wire/serialize.ts";
import { bytesToHex } from "../../utils/encoding.ts";

export type EstimateFeeParams = {
	transaction: StacksTransaction;
};

export type FeeEstimation = {
	feeRate: number;
	fee: number;
};

function isValidEstimation(
	e: unknown,
): e is { fee_rate: number | string; fee: number | string } {
	return (
		typeof e === "object" &&
		e !== null &&
		"fee_rate" in e &&
		"fee" in e &&
		(typeof (e as Record<string, unknown>).fee_rate === "number" ||
			typeof (e as Record<string, unknown>).fee_rate === "string") &&
		(typeof (e as Record<string, unknown>).fee === "number" ||
			typeof (e as Record<string, unknown>).fee === "string")
	);
}

export async function estimateFee(
	client: Client,
	params: EstimateFeeParams,
): Promise<FeeEstimation[]> {
	const payloadHex = bytesToHex(serializePayload(params.transaction.payload));
	const txHex = bytesToHex(serializeTransaction(params.transaction));

	const data = await client.request("/v2/fees/transaction", {
		method: "POST",
		body: {
			estimated_len: Math.ceil(txHex.length / 2),
			transaction_payload: `0x${payloadHex}`,
		},
	});

	const raw = (data as { estimations?: unknown[] })?.estimations ?? [];
	return raw.map((e) => {
		if (!isValidEstimation(e)) {
			throw new MalformedResponseError(
				"estimateFee: node response contains invalid fee estimation entry",
			);
		}
		return {
			feeRate: Number(e.fee_rate),
			fee: Number(e.fee),
		};
	});
}
