import type { Client } from "../../clients/types.ts";
import type { StacksTransaction } from "../../transactions/types.ts";
import { PayloadType, AddressHashMode } from "../../transactions/types.ts";
import { c32address } from "../../utils/address.ts";
import { simulateCall, type SimulateCallResult } from "./simulateCall.ts";
import { estimateFee, type FeeEstimation } from "./estimateFee.ts";

export type SimulateTransactionParams = {
  transaction: StacksTransaction;
  sender?: string;
  tip?: string;
};

export type SimulateContractCallResult = {
  type: "contract-call";
  execution: SimulateCallResult;
  fees: FeeEstimation[];
};

export type SimulateTransferResult = {
  type: "token-transfer";
  fees: FeeEstimation[];
};

export type SimulateDeployResult = {
  type: "contract-deploy";
  fees: FeeEstimation[];
};

export type SimulateTransactionResult =
  | SimulateContractCallResult
  | SimulateTransferResult
  | SimulateDeployResult;

function isMultiSig(hashMode: number): boolean {
  return (
    hashMode === AddressHashMode.P2SH ||
    hashMode === AddressHashMode.P2WSH ||
    hashMode === AddressHashMode.P2SH_NonSequential ||
    hashMode === AddressHashMode.P2WSH_P2SH_NonSequential
  );
}

function extractSender(tx: StacksTransaction, client: Client): string {
  const { hashMode, signer } = tx.auth.spendingCondition;
  const chain = client.chain;
  const version = isMultiSig(hashMode)
    ? chain?.addressVersion.multiSig ?? 20
    : chain?.addressVersion.singleSig ?? 22;
  return c32address(version, signer);
}

export async function simulateTransaction(
  client: Client,
  params: SimulateTransactionParams,
): Promise<SimulateTransactionResult> {
  const { transaction, tip } = params;
  const { payload } = transaction;

  if (payload.payloadType === PayloadType.ContractCall) {
    const sender = params.sender ?? extractSender(transaction, client);
    const contract = `${payload.contractAddress}.${payload.contractName}`;

    const [execution, fees] = await Promise.all([
      simulateCall(client, {
        contract,
        functionName: payload.functionName,
        args: payload.functionArgs,
        sender,
        tip,
      }),
      estimateFee(client, { transaction }),
    ]);

    return { type: "contract-call", execution, fees };
  }

  const fees = await estimateFee(client, { transaction });

  if (
    payload.payloadType === PayloadType.SmartContract ||
    payload.payloadType === PayloadType.VersionedSmartContract
  ) {
    return { type: "contract-deploy", fees };
  }

  return { type: "token-transfer", fees };
}
