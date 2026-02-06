import type { Client } from "../../clients/types.ts";
import { signTransactionWithAccount } from "../../transactions/signer.ts";
import { serializeTransactionHex } from "../../transactions/wire/serialize.ts";
import { deserializeTransaction } from "../../transactions/wire/deserialize.ts";
import type { StacksTransaction } from "../../transactions/types.ts";
import { isProviderAccount } from "./utils.ts";

export type SignTransactionParams = {
  transaction: StacksTransaction;
};

/** Sign a transaction using the client's account */
export async function signTransactionAction(
  client: Client,
  params: SignTransactionParams
): Promise<StacksTransaction> {
  const account = client.account;
  if (!account) throw new Error("Account required");

  // Provider: send hex to wallet, get signed hex back
  if (isProviderAccount(account)) {
    const hex = serializeTransactionHex(params.transaction);
    const result = await account.provider.request("stx_signTransaction", {
      transaction: hex,
    });
    return deserializeTransaction(result.transaction);
  }

  // Local/Custom: sign with account
  return signTransactionWithAccount(params.transaction, account);
}
