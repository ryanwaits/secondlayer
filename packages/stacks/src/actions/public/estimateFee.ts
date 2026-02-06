import type { Client } from "../../clients/types.ts";
import { bytesToHex } from "../../utils/encoding.ts";
import { serializeTransaction } from "../../transactions/wire/serialize.ts";
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
  const serialized = bytesToHex(serializeTransaction(params.transaction));

  const data = await client.request("/v2/fees/transaction", {
    method: "POST",
    body: {
      estimated_len: Math.ceil(serialized.length / 2),
      transaction_payload: serialized,
    },
  });

  return data.estimations ?? [];
}
