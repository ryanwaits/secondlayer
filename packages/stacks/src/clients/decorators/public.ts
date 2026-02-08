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
import { multicall, type MulticallParams, type MulticallResult } from "../../actions/public/multicall.ts";
import { simulateCall, type SimulateCallParams, type SimulateCallResult } from "../../actions/public/simulateCall.ts";
import { simulateTransaction, type SimulateTransactionParams, type SimulateTransactionResult } from "../../actions/public/simulateTransaction.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import type { Subscription } from "../../subscriptions/types.ts";
import {
  watchBlocks, type WatchBlocksParams,
  watchMempool, type WatchMempoolParams,
  watchTransaction, type WatchTransactionParams,
  watchAddress, type WatchAddressParams,
  watchAddressBalance, type WatchAddressBalanceParams,
  watchNftEvent, type WatchNftEventParams,
} from "../../subscriptions/actions.ts";

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
  multicall: <T extends boolean = true>(params: MulticallParams<T>) => Promise<MulticallResult<T>>;
  simulateCall: (params: SimulateCallParams) => Promise<SimulateCallResult>;
  simulateTransaction: (params: SimulateTransactionParams) => Promise<SimulateTransactionResult>;
  watchBlocks: (params: WatchBlocksParams) => Promise<Subscription>;
  watchMempool: (params: WatchMempoolParams) => Promise<Subscription>;
  watchTransaction: (params: WatchTransactionParams) => Promise<Subscription>;
  watchAddress: (params: WatchAddressParams) => Promise<Subscription>;
  watchAddressBalance: (params: WatchAddressBalanceParams) => Promise<Subscription>;
  watchNftEvent: (params: WatchNftEventParams) => Promise<Subscription>;
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
    multicall: (params) => multicall(client, params),
    simulateCall: (params) => simulateCall(client, params),
    simulateTransaction: (params) => simulateTransaction(client, params),
    watchBlocks: (params) => watchBlocks(client, params),
    watchMempool: (params) => watchMempool(client, params),
    watchTransaction: (params) => watchTransaction(client, params),
    watchAddress: (params) => watchAddress(client, params),
    watchAddressBalance: (params) => watchAddressBalance(client, params),
    watchNftEvent: (params) => watchNftEvent(client, params),
  };
}
