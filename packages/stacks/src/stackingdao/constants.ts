const DEPLOYER = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG";

export const STACKINGDAO_CONTRACTS = {
  core: { address: DEPLOYER, name: "stacking-dao-core-v6" },
  ststxToken: { address: DEPLOYER, name: "ststx-token" },
  withdrawNft: { address: DEPLOYER, name: "ststx-withdraw-nft-v2" },
  reserve: { address: DEPLOYER, name: "reserve-v1" },
  dataCore: { address: DEPLOYER, name: "data-core-v3" },
  dataCoreV1: { address: DEPLOYER, name: "data-core-v1" },
} as const;

/** Trait contracts auto-passed to core functions — users never need these. */
export const TRAIT_CONTRACTS = {
  reserve: `${DEPLOYER}.reserve-v1`,
  commission: `${DEPLOYER}.commission-v2`,
  directHelpers: `${DEPLOYER}.direct-helpers-v4`,
  staking: `${DEPLOYER}.staking-v0`,
} as const;
