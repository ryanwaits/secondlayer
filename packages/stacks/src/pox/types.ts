/** Bitcoin address in Clarity tuple format for PoX */
export interface PoxAddress {
  version: Uint8Array; // buff 1
  hashbytes: Uint8Array; // buff 32
}

/** User-facing params for stack-stx */
export interface StackStxParams {
  amount: bigint; // microSTX
  btcAddress: string; // Any BTC format (P2PKH, P2WPKH, P2TR, etc.)
  lockPeriod: number; // 1-12 cycles
  signerSig: Uint8Array | null; // buff 65, null to use on-chain authorization
  signerKey: Uint8Array; // buff 33 (compressed pubkey)
  maxAmount: bigint;
  authId: bigint;
  startBurnHeight: bigint; // burn height at which stacking begins
}

/** User-facing params for delegate-stx */
export interface DelegateStxParams {
  amount: bigint; // microSTX
  delegateTo: string; // Pool operator Stacks address
  untilBurnHeight?: bigint | null; // optional expiry
  poxAddr?: string | null; // optional BTC address restriction
}

/** User-facing params for stack-extend */
export interface StackExtendParams {
  extendCount: number; // 1-12 additional cycles
  btcAddress: string;
  signerSig: Uint8Array | null;
  signerKey: Uint8Array;
  maxAmount: bigint;
  authId: bigint;
}

/** User-facing params for stack-increase */
export interface StackIncreaseParams {
  increaseBy: bigint; // additional microSTX
  signerSig: Uint8Array | null;
  signerKey: Uint8Array;
  maxAmount: bigint;
  authId: bigint;
}

/** PoX network info from get-pox-info */
export interface PoxInfo {
  rewardCycleId: bigint;
  minAmountUstx: bigint;
  prepareCycleLength: bigint;
  rewardCycleLength: bigint;
  firstBurnchainBlockHeight: bigint;
  totalLiquidSupplyUstx: bigint;
}

/** Stacker info from get-stacker-info */
export interface StackerInfo {
  firstRewardCycle: bigint;
  lockPeriod: bigint;
  poxAddr: PoxAddress;
  rewardSetIndexes: bigint[];
  delegatedTo: string | null;
}

/** Delegation info from get-delegation-info */
export interface DelegationInfo {
  amountUstx: bigint;
  delegatedTo: string;
  untilBurnHt: bigint | null;
  poxAddr: PoxAddress | null;
}
