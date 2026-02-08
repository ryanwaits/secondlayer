export interface DepositParams {
  amount: bigint;
  referrer?: string;
  pool?: string;
}

export interface InitWithdrawParams {
  ststxAmount: bigint;
}

export interface WithdrawParams {
  nftId: bigint;
}

export interface WithdrawIdleParams {
  ststxAmount: bigint;
}

export interface ExchangeRateInfo {
  stxPerStstx: bigint;
  ststxSupply: bigint;
  totalStx: bigint;
}

export interface WithdrawalInfo {
  ststxAmount: bigint;
  stxAmount: bigint;
  unlockBurnHeight: bigint;
}

export interface FeeInfo {
  stackFee: bigint;
  unstackFee: bigint;
  withdrawIdleFee: bigint;
}
