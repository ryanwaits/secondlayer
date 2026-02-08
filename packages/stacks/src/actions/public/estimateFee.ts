import type { Client } from "../../clients/types.ts";
import { bytesToHex } from "../../utils/encoding.ts";
import { serializePayload, serializeTransaction } from "../../transactions/wire/serialize.ts";
import type { StacksTransaction } from "../../transactions/types.ts";

export type EstimateFeeParams = {
  transaction: StacksTransaction;
};

export type FeeEstimation = {
  feeRate: number;
  fee: number;
};

export async function estimateFee(
  client: Client,
  params: EstimateFeeParams
): Promise<FeeEstimation[]> {
  const payloadHex = bytesToHex(serializePayload(params.transaction.payload));
  const txHex = bytesToHex(serializeTransaction(params.transaction));

  const data = await client.request("/v2/fees/transaction", {
    method: "POST",
    body: {
      estimated_len: Math.ceil(txHex.length / 2),
      transaction_payload: "0x" + payloadHex,
    },
  });

  return (data.estimations ?? []).map((e: any) => ({
    feeRate: e.fee_rate,
    fee: e.fee,
  }));
}
