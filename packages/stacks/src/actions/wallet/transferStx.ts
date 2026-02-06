import type { Client } from "../../clients/types.ts";
import type { PostCondition } from "../../postconditions/types.ts";
import type { IntegerType } from "../../utils/encoding.ts";
import { buildTokenTransfer } from "../../transactions/build.ts";
import { signTransactionWithAccount } from "../../transactions/signer.ts";
import { sendTransaction } from "./sendTransaction.ts";
import { getNonce } from "../public/getNonce.ts";
import { estimateFee } from "../public/estimateFee.ts";
import { isProviderAccount } from "./utils.ts";

export type TransferStxParams = {
  to: string;
  amount: IntegerType;
  memo?: string;
  fee?: IntegerType;
  nonce?: IntegerType;
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
};

/** Build, sign, and broadcast an STX transfer */
export async function transferStx(
  client: Client,
  params: TransferStxParams
): Promise<string> {
  const account = client.account;
  if (!account) throw new Error("Account required");

  // Provider: delegate to wallet
  if (isProviderAccount(account)) {
    const result = await account.provider.request("stx_transferStx", {
      recipient: params.to,
      amount: String(params.amount),
      memo: params.memo,
    });
    return result.txid;
  }

  // Local/Custom: build → sign → broadcast
  const nonce =
    params.nonce ?? await getNonce(client, { address: account.address });

  const unsigned = buildTokenTransfer({
    recipient: params.to,
    amount: params.amount,
    memo: params.memo,
    fee: params.fee ?? 0n,
    nonce,
    publicKey: account.publicKey,
    chain: client.chain,
    postConditionMode: params.postConditionMode,
    postConditions: params.postConditions,
  });

  if (params.fee === undefined) {
    const estimates = await estimateFee(client, { transaction: unsigned });
    const mid = estimates[1] ?? estimates[0];
    if (mid) {
      (unsigned.auth.spendingCondition as any).fee = BigInt(mid.fee);
    }
  }

  const signed = await signTransactionWithAccount(unsigned, account);
  const result = await sendTransaction(client, { transaction: signed });
  return result.txid;
}
