// Clarity integer bounds
export const MAX_U128 = (1n << 128n) - 1n;
export const MAX_I128 = (1n << 127n) - 1n;
export const MIN_I128 = -(1n << 127n);

// Address versions
export const AddressVersion = {
  MainnetSingleSig: 22,
  MainnetMultiSig: 20,
  TestnetSingleSig: 26,
  TestnetMultiSig: 21,
} as const;
export type AddressVersion = (typeof AddressVersion)[keyof typeof AddressVersion];

// Burn / zero addresses (all-zero hash160)
export const ZERO_ADDRESS = "SP000000000000000000002Q6VF78";
export const TESTNET_ZERO_ADDRESS = "ST000000000000000000002AMW42H";

// STX denomination
export const MICROSTX_PER_STX = 1_000_000n;
