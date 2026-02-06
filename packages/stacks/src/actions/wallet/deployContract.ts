import type { Client } from "../../clients/types.ts";
import type { ClarityVersion } from "../../transactions/types.ts";
import type { PostCondition } from "../../postconditions/types.ts";
import type { IntegerType } from "../../utils/encoding.ts";
import { buildContractDeploy } from "../../transactions/build.ts";
import { signTransactionWithAccount } from "../../transactions/signer.ts";
import { sendTransaction } from "./sendTransaction.ts";
import { getNonce } from "../public/getNonce.ts";
import { estimateFee } from "../public/estimateFee.ts";
import { isProviderAccount } from "./utils.ts";

export type DeployContractParams = {
  contractName: string;
  codeBody: string;
  clarityVersion?: ClarityVersion;
  fee?: IntegerType;
  nonce?: IntegerType;
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
};

/** Build, sign, and broadcast a contract deploy */
export async function deployContract(
  client: Client,
  params: DeployContractParams
): Promise<string> {
  const account = client.account;
  if (!account) throw new Error("Account required");

  // Provider: delegate to wallet
  if (isProviderAccount(account)) {
    const result = await account.provider.request("stx_deployContract", {
      contractName: params.contractName,
      codeBody: params.codeBody,
      clarityVersion: params.clarityVersion,
    });
    return result.txid;
  }

  // Local/Custom: build → sign → broadcast
  const nonce =
    params.nonce ?? await getNonce(client, { address: account.address });

  const unsigned = buildContractDeploy({
    contractName: params.contractName,
    codeBody: params.codeBody,
    clarityVersion: params.clarityVersion,
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
