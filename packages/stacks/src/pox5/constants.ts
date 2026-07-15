/**
 * PoX-5 (SIP-045 Bitcoin Staking) constants, pinned against the final
 * contract shipped in stacks-core 4.0.0 (`stackslib/.../boot/pox-5.clar`).
 */

/** Boot contract name; deployer is the chain's boot address. */
export const POX5_CONTRACT_NAME = "pox-5";

/**
 * Epoch 4.0 hard-fork activation height on mainnet — Bitcoin block 960,230
 * (expected ~2026-07-29 03:00 UTC, per the stacks-core 4.0.0 release).
 * Prefer the runtime gate in `activation.ts` (`getPox5Activation`), which
 * reads the node's `/v2/pox` and needs no hardcoded height.
 */
export const POX5_ACTIVATION_BURN_HEIGHT_MAINNET = 960_230;

/** Length of a paired-BTC bond, in reward cycles (`BOND_LENGTH_CYCLES`). */
export const BOND_LENGTH_CYCLES = 12;

/** Gap between consecutive bond starts, in reward cycles (`BOND_GAP_CYCLES`). */
export const BOND_GAP_CYCLES = 2;

/** Hard cap for STX-only stake duration, in cycles (`MAX_NUM_CYCLES`). */
export const MAX_NUM_CYCLES = 96;

/** SIP-018 domain for signer-key grants (`POX_5_SIGNER_DOMAIN`). */
export const POX5_SIGNER_DOMAIN = {
	name: "pox-5-signer",
	version: "1.0.0",
} as const;

/**
 * `serialize-c-script-num` rejects values at or above 2^39 — the ceiling of a
 * 5-byte minimally-encoded ScriptNum (`ERR_INVALID_UNLOCK_HEIGHT`).
 */
export const C_SCRIPT_NUM_MAX = 549_755_813_888n; // 2^39

/**
 * Bitcoin treats CLTV values >= 500,000,000 as Unix timestamps (BIP-65); the
 * contract rejects unlock heights at or above this so a lockup can never
 * commit a height Bitcoin would reinterpret.
 */
export const BITCOIN_LOCKTIME_THRESHOLD = 500_000_000n;
