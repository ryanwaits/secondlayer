import type { Client } from "../../clients/types.ts";
import { signTransactionWithAccount } from "../../transactions/signer.ts";
import { signMultiSigWithAccount } from "../../transactions/multisig.ts";
import { serializeTransactionHex } from "../../transactions/wire/serialize.ts";
import { deserializeTransaction } from "../../transactions/wire/deserialize.ts";
import type { StacksTransaction } from "../../transactions/types.ts";
import { isProviderAccount } from "./utils.ts";

export type SignTransactionParams = {
  transaction: StacksTransaction;
  /** Public keys for multi-sig signing (auto-detected from _multisig metadata if omitted) */
  signers?: string[];
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

  // Multi-sig: auto-detect from fields or _multisig metadata
  const condition = params.transaction.auth.spendingCondition;
  if ("fields" in condition) {
    const publicKeys = params.signers ?? (params.transaction as any)._multisig?.publicKeys;
    if (!publicKeys) throw new Error("Multi-sig signing requires signers (publicKeys)");
    return signMultiSigWithAccount(params.transaction, account, publicKeys);
  }

  // Local/Custom: sign with account
  return signTransactionWithAccount(params.transaction, account);
}
