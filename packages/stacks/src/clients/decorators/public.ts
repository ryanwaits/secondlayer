import type { Client } from "../types.ts";
import { getNonce, type GetNonceParams } from "../../actions/public/getNonce.ts";
import { getBalance, type GetBalanceParams } from "../../actions/public/getBalance.ts";
import { getAccountInfo, type GetAccountInfoParams, type AccountInfo } from "../../actions/public/getAccountInfo.ts";
import { getBlock, type GetBlockParams } from "../../actions/public/getBlock.ts";
import { getBlockHeight } from "../../actions/public/getBlockHeight.ts";
import { readContract, type ReadContractParams } from "../../actions/public/readContract.ts";
import { getContractAbi, type GetContractAbiParams } from "../../actions/public/getContractAbi.ts";
import { getMapEntry, type GetMapEntryParams } from "../../actions/public/getMapEntry.ts";
import { estimateFee, type EstimateFeeParams, type FeeEstimation } from "../../actions/public/estimateFee.ts";
import type { ClarityValue } from "../../clarity/types.ts";

export type PublicActions = {
  getNonce: (params: GetNonceParams) => Promise<bigint>;
  getBalance: (params: GetBalanceParams) => Promise<bigint>;
  getAccountInfo: (params: GetAccountInfoParams) => Promise<AccountInfo>;
  getBlock: (params: GetBlockParams) => Promise<any>;
  getBlockHeight: () => Promise<number>;
  readContract: (params: ReadContractParams) => Promise<ClarityValue>;
  getContractAbi: (params: GetContractAbiParams) => Promise<any>;
  getMapEntry: (params: GetMapEntryParams) => Promise<ClarityValue>;
  estimateFee: (params: EstimateFeeParams) => Promise<FeeEstimation[]>;
};

export function publicActions(client: Client): PublicActions {
  return {
    getNonce: (params) => getNonce(client, params),
    getBalance: (params) => getBalance(client, params),
    getAccountInfo: (params) => getAccountInfo(client, params),
    getBlock: (params) => getBlock(client, params),
    getBlockHeight: () => getBlockHeight(client),
    readContract: (params) => readContract(client, params),
    getContractAbi: (params) => getContractAbi(client, params),
    getMapEntry: (params) => getMapEntry(client, params),
    estimateFee: (params) => estimateFee(client, params),
  };
}
