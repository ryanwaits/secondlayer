import type { Client } from "../clients/types.ts";
import {
  deposit,
  initWithdraw,
  withdraw,
  withdrawIdle,
  getStSTXBalance,
  getExchangeRate,
  getTotalSupply,
  getWithdrawalInfo,
  getFees,
  getReserveBalance,
  getShutdownDeposits,
} from "./actions.ts";
import type {
  DepositParams,
  InitWithdrawParams,
  WithdrawParams,
  WithdrawIdleParams,
  ExchangeRateInfo,
  WithdrawalInfo,
  FeeInfo,
} from "./types.ts";

export type {
  DepositParams,
  InitWithdrawParams,
  WithdrawParams,
  WithdrawIdleParams,
  ExchangeRateInfo,
  WithdrawalInfo,
  FeeInfo,
};
export { STACKING_DAO_CORE_ABI, DATA_CORE_V1_ABI, DATA_CORE_V3_ABI, RESERVE_V1_ABI } from "./abi.ts";
export { STACKINGDAO_CONTRACTS, TRAIT_CONTRACTS } from "./constants.ts";

/**
 * StackingDAO liquid staking extension.
 * Deposit STX → receive stSTX. Auto-compounding stacking rewards.
 *
 * @example
 * import { createWalletClient, http, mainnet } from "stacks";
 * import { stackingDao } from "stacks/stackingdao";
 *
 * const client = createWalletClient({ ... }).extend(stackingDao());
 *
 * // Deposit STX for stSTX
 * await client.stackingDao.deposit({ amount: 100_000_000_000n });
 *
 * // Check exchange rate
 * const rate = await client.stackingDao.getExchangeRate();
 */
export function stackingDao() {
  return (client: Client) => ({
    stackingDao: {
      /** Deposit STX, receive stSTX. */
      deposit: (params: DepositParams) => deposit(client, params),

      /** Initiate withdrawal — burns stSTX, mints NFT receipt. */
      initWithdraw: (params: InitWithdrawParams) => initWithdraw(client, params),

      /** Finalize withdrawal — burns NFT, receive STX. */
      withdraw: (params: WithdrawParams) => withdraw(client, params),

      /** Withdraw idle STX instantly (burns stSTX). */
      withdrawIdle: (params: WithdrawIdleParams) => withdrawIdle(client, params),

      /** Get stSTX balance for an address. */
      getStSTXBalance: (address: string) => getStSTXBalance(client, address),

      /** Get current STX/stSTX exchange rate info. */
      getExchangeRate: () => getExchangeRate(client),

      /** Get total stSTX supply. */
      getTotalSupply: () => getTotalSupply(client),

      /** Get withdrawal NFT info by ID. Returns tuple with amounts and unlock height. */
      getWithdrawalInfo: (nftId: bigint) => getWithdrawalInfo(client, nftId),

      /** Get current fee rates. */
      getFees: () => getFees(client),

      /** Get total STX in reserve. */
      getReserveBalance: () => getReserveBalance(client),

      /** Check if deposits are shut down. */
      getShutdownDeposits: () => getShutdownDeposits(client),
    },
  });
}
