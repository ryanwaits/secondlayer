/**
 * Mapped read-return types for the pox-5 contract — the JS shapes
 * `getContract` produces from the ABI (camelCase keys, `uint` → `bigint`,
 * `buff` → `Uint8Array`, `none` → `null`, response ok auto-unwrapped).
 */

/** Staker info from `get-staker-info`; `null` when expired/absent. */
export type StakerInfo = {
	amountUstx: bigint;
	firstRewardCycle: bigint;
	numCycles: bigint;
	signer: string;
} | null;

/** Bond membership from `get-bond-membership`; `null` when not in a bond. */
export type BondMembership = {
	amountSats: bigint;
	amountUstx: bigint;
	bondIndex: bigint;
	isL1Lock: boolean;
	signer: string;
} | null;

/** Bond parameters from `get-protocol-bond`; `null` for an unknown bond. */
export type ProtocolBond = {
	earlyUnlockBytes: Uint8Array;
	minUstxRatio: bigint;
	stxValueRatio: bigint;
	targetRate: bigint;
} | null;

/** Allowlisted max sats from `get-bond-allowance`; `null` when not allowlisted. */
export type BondAllowance = bigint | null;

/** Signer key from `get-signer-info`; `null` for an unknown signer. */
export type SignerInfo = Uint8Array | null;
