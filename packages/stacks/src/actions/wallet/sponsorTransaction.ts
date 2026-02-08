import type { Client } from "../../clients/types.ts";
import type { IntegerType } from "../../utils/encoding.ts";
import { intToBigInt } from "../../utils/encoding.ts";
import {
  AuthType,
  type StacksTransaction,
  type SponsoredAuthorization,
  type SingleSigSpendingCondition,
} from "../../transactions/types.ts";
import { createSingleSigSpendingCondition } from "../../transactions/authorization.ts";
import { signSponsorWithAccount } from "../../transactions/signer.ts";
import { getNonce } from "../public/getNonce.ts";
import { estimateFee } from "../public/estimateFee.ts";
import { isProviderAccount } from "./utils.ts";

export type SponsorTransactionParams = {
  transaction: StacksTransaction;
  fee?: IntegerType;
  nonce?: IntegerType;
};

/** Sponsor a transaction: set sponsor spending condition, sign as sponsor */
export async function sponsorTransaction(
  client: Client,
  params: SponsorTransactionParams
): Promise<StacksTransaction> {
  const { transaction } = params;

  if (transaction.auth.authType !== AuthType.Sponsored) {
    throw new Error("Transaction must have sponsored authorization");
  }

  const account = client.account;
  if (!account) throw new Error("Account required");
  if (isProviderAccount(account)) {
    throw new Error("Provider accounts cannot sponsor transactions");
  }

  // Resolve sponsor nonce
  const nonce = params.nonce != null
    ? intToBigInt(params.nonce)
    : await getNonce(client, { address: account.address });

  // Resolve sponsor fee
  let fee: bigint;
  if (params.fee != null) {
    fee = intToBigInt(params.fee);
  } else {
    const estimates = await estimateFee(client, { transaction });
    const mid = estimates[1] ?? estimates[0];
    fee = mid ? BigInt(mid.fee) : 0n;
  }

  // Create sponsor spending condition
  const sponsorCondition = createSingleSigSpendingCondition(
    account.publicKey,
    nonce,
    fee
  );

  // Set sponsor spending condition on the tx
  const auth = transaction.auth as SponsoredAuthorization;
  const sponsored: StacksTransaction = {
    ...transaction,
    auth: {
      ...auth,
      sponsorSpendingCondition: sponsorCondition,
    },
  };

  // Sign as sponsor
  return signSponsorWithAccount(sponsored, account);
}
