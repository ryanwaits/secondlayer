import {
	type EstimateFeeParams,
	type FeeEstimation,
	estimateFee,
} from "../../actions/public/estimateFee.ts";
import {
	type AccountInfo,
	type GetAccountInfoParams,
	getAccountInfo,
} from "../../actions/public/getAccountInfo.ts";
import {
	type GetBalanceParams,
	getBalance,
} from "../../actions/public/getBalance.ts";
import {
	type GetBlockParams,
	getBlock,
} from "../../actions/public/getBlock.ts";
import { getBlockHeight } from "../../actions/public/getBlockHeight.ts";
import {
	type GetContractAbiParams,
	getContractAbi,
} from "../../actions/public/getContractAbi.ts";
import {
	type GetMapEntryParams,
	getMapEntry,
} from "../../actions/public/getMapEntry.ts";
import {
	type GetNonceParams,
	getNonce,
} from "../../actions/public/getNonce.ts";
import {
	type MulticallParams,
	type MulticallResult,
	multicall,
} from "../../actions/public/multicall.ts";
import {
	type ReadContractParams,
	readContract,
} from "../../actions/public/readContract.ts";
import {
	type SimulateCallParams,
	type SimulateCallResult,
	simulateCall,
} from "../../actions/public/simulateCall.ts";
import {
	type SimulateTransactionParams,
	type SimulateTransactionResult,
	simulateTransaction,
} from "../../actions/public/simulateTransaction.ts";
import type { ClarityValue } from "../../clarity/types.ts";
import {
	type WatchAddressBalanceParams,
	type WatchAddressParams,
	type WatchBlocksParams,
	type WatchMempoolParams,
	type WatchNftEventParams,
	type WatchTransactionParams,
	watchAddress,
	watchAddressBalance,
	watchBlocks,
	watchMempool,
	watchNftEvent,
	watchTransaction,
} from "../../subscriptions/actions.ts";
import type { Subscription } from "../../subscriptions/types.ts";
import type { Client } from "../types.ts";

/** Read-only actions: balance queries, contract reads, block data, and event subscriptions. */
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
	multicall: <T extends boolean = true>(
		params: MulticallParams<T>,
	) => Promise<MulticallResult<T>>;
	simulateCall: (params: SimulateCallParams) => Promise<SimulateCallResult>;
	simulateTransaction: (
		params: SimulateTransactionParams,
	) => Promise<SimulateTransactionResult>;
	watchBlocks: (params: WatchBlocksParams) => Promise<Subscription>;
	watchMempool: (params: WatchMempoolParams) => Promise<Subscription>;
	watchTransaction: (params: WatchTransactionParams) => Promise<Subscription>;
	watchAddress: (params: WatchAddressParams) => Promise<Subscription>;
	watchAddressBalance: (
		params: WatchAddressBalanceParams,
	) => Promise<Subscription>;
	watchNftEvent: (params: WatchNftEventParams) => Promise<Subscription>;
};

/** Decorator that binds {@link PublicActions} to a client instance. */
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
