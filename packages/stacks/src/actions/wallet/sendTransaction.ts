import type { Client, WalletClient } from "../../clients/types.ts";
import { bytesToHex } from "../../utils/encoding.ts";
import { serializeTransaction } from "../../transactions/wire/serialize.ts";
import { getTransactionId } from "../../transactions/signer.ts";
import type { StacksTransaction } from "../../transactions/types.ts";
import { BroadcastError } from "../../errors/transaction.ts";

export type SendTransactionParams = {
  transaction: StacksTransaction;
  attachment?: Uint8Array | string;
};

export type SendTransactionResult = {
  txid: string;
};

/** Broadcast a signed transaction to the network */
export async function sendTransaction(
  client: Client,
  params: SendTransactionParams
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
    });
  }

  const txid =
    typeof data === "string"
      ? data.replace(/"/g, "")
      : data.txid ?? getTransactionId(params.transaction);

  return { txid };
}
