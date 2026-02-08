import type { Client } from "../types.ts";
import type { PostCondition } from "../../postconditions/types.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import type { IntegerType } from "../../utils/encoding.ts";
import type { StacksTransaction, ClarityVersion, MultiSigHashMode } from "../../transactions/types.ts";
import { buildTokenTransfer, buildContractCall, buildContractDeploy } from "../../transactions/build.ts";
import { finalizeMultiSig, isNonSequential } from "../../transactions/multisig.ts";
import { sendTransaction, type SendTransactionResult } from "../../actions/wallet/sendTransaction.ts";
import { getNonce } from "../../actions/public/getNonce.ts";
import { estimateFee } from "../../actions/public/estimateFee.ts";
import { parseContractId } from "../../utils/address.ts";

export type MultiSigTransferStxParams = {
  to: string;
  amount: IntegerType;
  memo?: string;
  fee?: IntegerType;
  nonce?: IntegerType;
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
};

export type MultiSigCallContractParams = {
  contract: string;
  functionName: string;
  functionArgs?: ClarityValue[];
  fee?: IntegerType;
  nonce?: IntegerType;
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
};

export type MultiSigDeployContractParams = {
  contractName: string;
  codeBody: string;
  clarityVersion?: ClarityVersion;
  fee?: IntegerType;
  nonce?: IntegerType;
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
};

export type MultiSigSendTransactionParams = {
  transaction: StacksTransaction;
  attachment?: Uint8Array | string;
};

export type MultiSigActions = {
  transferStx: (params: MultiSigTransferStxParams) => Promise<StacksTransaction>;
  callContract: (params: MultiSigCallContractParams) => Promise<StacksTransaction>;
  deployContract: (params: MultiSigDeployContractParams) => Promise<StacksTransaction>;
  sendTransaction: (params: MultiSigSendTransactionParams) => Promise<SendTransactionResult>;
};

export function multisigActions(client: Client): MultiSigActions {
  const msConfig = (client as any)._multisigConfig as {
    signers: string[];
    requiredSignatures: number;
    hashMode?: MultiSigHashMode;
  };

  if (!msConfig) throw new Error("multisigActions requires a multi-sig client");

  const { signers, requiredSignatures, hashMode } = msConfig;

  /** Resolve nonce from the multi-sig address */
  async function resolveNonce(nonce?: IntegerType): Promise<IntegerType> {
    if (nonce !== undefined) return nonce;
    const { makeMultiSigAddress } = await import("../../transactions/multisig.ts");
    const address = makeMultiSigAddress(signers, requiredSignatures, client.chain);
    return getNonce(client, { address });
  }

  return {
    async transferStx(params) {
      const nonce = await resolveNonce(params.nonce);

      const unsigned = buildTokenTransfer({
        recipient: params.to,
        amount: params.amount,
        memo: params.memo,
        fee: params.fee ?? 0n,
        nonce,
        publicKeys: signers,
        signaturesRequired: requiredSignatures,
        hashMode,
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

      return unsigned;
    },

    async callContract(params) {
      const [contractAddress, contractName] = parseContractId(params.contract);
      const nonce = await resolveNonce(params.nonce);

      const unsigned = buildContractCall({
        contractAddress,
        contractName,
        functionName: params.functionName,
        functionArgs: params.functionArgs ?? [],
        fee: params.fee ?? 0n,
        nonce,
        publicKeys: signers,
        signaturesRequired: requiredSignatures,
        hashMode,
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

      return unsigned;
    },

    async deployContract(params) {
      const nonce = await resolveNonce(params.nonce);

      const unsigned = buildContractDeploy({
        contractName: params.contractName,
        codeBody: params.codeBody,
        clarityVersion: params.clarityVersion,
        fee: params.fee ?? 0n,
        nonce,
        publicKeys: signers,
        signaturesRequired: requiredSignatures,
        hashMode,
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

      return unsigned;
    },

    async sendTransaction(params) {
      // Auto-finalize before broadcast
      const finalized = finalizeMultiSig(params.transaction, signers);
      return sendTransaction(client, {
        transaction: finalized,
        attachment: params.attachment,
      });
    },
  };
}
