import type { Client } from "../clients/types.ts";
import {
  getPoxInfo,
  getStackerInfo,
  getDelegationInfo,
  canStack,
  stackStx,
  delegateStx,
  revokeDelegateStx,
  stackExtend,
  stackIncrease,
} from "./actions.ts";
import type {
  StackStxParams,
  DelegateStxParams,
  StackExtendParams,
  StackIncreaseParams,
  PoxInfo,
  StackerInfo,
  DelegationInfo,
} from "./types.ts";

export type {
  StackStxParams,
  DelegateStxParams,
  StackExtendParams,
  StackIncreaseParams,
  PoxInfo,
  StackerInfo,
  DelegationInfo,
};
export type { PoxAddress } from "./types.ts";
export { POX_CONTRACTS, POX_ADDRESS_VERSION, MIN_LOCK_PERIOD, MAX_LOCK_PERIOD } from "./constants.ts";
export {
  parseBtcAddress,
  validateLockPeriod,
  burnHeightToRewardCycle,
  rewardCycleToBurnHeight,
} from "./utils.ts";

/**
 * PoX stacking extension for Stacks client.
 * Handles STX stacking for Bitcoin rewards (solo + pool delegation).
 *
 * @example
 * import { createWalletClient, http, mainnet } from "stacks";
 * import { pox } from "stacks/pox";
 *
 * const client = createWalletClient({ ... }).extend(pox());
 *
 * // Delegate to pool
 * await client.pox.delegateStx({
 *   amount: 100_000n * 1_000_000n,
 *   delegateTo: "SP2...",
 * });
 *
 * // Solo stack
 * await client.pox.stackStx({
 *   amount: 100_000n * 1_000_000n,
 *   btcAddress: "bc1q...",
 *   lockPeriod: 12,
 *   startBurnHeight: 860000n,
 *   signerSig: signature,
 *   signerKey: publicKey,
 *   maxAmount: 100_000_000_000n,
 *   authId: 1n,
 * });
 */
export function pox() {
  return (client: Client) => ({
    pox: {
      /** Query current PoX network info (cycle, minimum, lengths). */
      getPoxInfo: () => getPoxInfo(client),

      /** Get stacker info for an address. Returns null if not stacking. */
      getStackerInfo: (address: string) => getStackerInfo(client, address),

      /** Get delegation info for an address. Returns null if not delegating. */
      getDelegationInfo: (address: string) => getDelegationInfo(client, address),

      /** Check if an amount meets the minimum stacking threshold. */
      canStack: (amount: bigint) => canStack(client, amount),

      /** Lock STX for stacking (solo). */
      stackStx: (params: StackStxParams) => stackStx(client, params),

      /** Delegate STX to a pool operator. */
      delegateStx: (params: DelegateStxParams) => delegateStx(client, params),

      /** Revoke an active delegation. */
      revokeDelegateStx: () => revokeDelegateStx(client),

      /** Extend an active stacking lock by additional cycles. */
      stackExtend: (params: StackExtendParams) => stackExtend(client, params),

      /** Increase the amount of locked STX. */
      stackIncrease: (params: StackIncreaseParams) =>
        stackIncrease(client, params),
    },
  });
}
