import { BOND_GAP_CYCLES, BOND_LENGTH_CYCLES } from "./constants.ts";

/**
 * Pure cycle/height math, mirroring the pox-5 helper read-onlys byte-for-byte
 * (`burn-height-to-reward-cycle`, `reward-cycle-to-burn-height`,
 * `bond-period-to-reward-cycle`, `burn-height-to-distribution-index`).
 *
 * All functions anchor on chain-reported parameters — pass values from
 * `/v2/pox` (`first_burnchain_block_height`, `reward_cycle_length`,
 * `prepare_cycle_length`) and `getPox5Activation` (`firstRewardCycleId` =
 * the contract's `first-bond-period-cycle`). Nothing is hardcoded, so the
 * math is correct on mainnet, testnet, and devnet alike.
 */
export type PoxCycleParams = {
	/** `/v2/pox` `first_burnchain_block_height`. */
	firstBurnchainBlockHeight: number;
	/** `/v2/pox` `reward_cycle_length` (mainnet 2100). */
	rewardCycleLength: number;
};

export type BondCycleParams = PoxCycleParams & {
	/** pox-5's first bond-period cycle (`getPox5Activation().firstRewardCycleId`). */
	firstBondPeriodCycle: number;
};

/** Reward cycle containing `burnHeight`. Mirrors `burn-height-to-reward-cycle`. */
export function burnHeightToRewardCycle(
	burnHeight: number,
	params: PoxCycleParams,
): number {
	if (burnHeight < params.firstBurnchainBlockHeight) {
		throw new Error(
			`burnHeight ${burnHeight} precedes first burnchain block ${params.firstBurnchainBlockHeight}`,
		);
	}
	return Math.floor(
		(burnHeight - params.firstBurnchainBlockHeight) / params.rewardCycleLength,
	);
}

/** Burn height at the start of `cycle`. Mirrors `reward-cycle-to-burn-height`. */
export function rewardCycleToBurnHeight(
	cycle: number,
	params: PoxCycleParams,
): number {
	return params.firstBurnchainBlockHeight + cycle * params.rewardCycleLength;
}

/** Reward cycle at which bond period `bondIndex` starts. Mirrors `bond-period-to-reward-cycle`. */
export function bondPeriodToRewardCycle(
	bondIndex: number,
	params: BondCycleParams,
): number {
	return params.firstBondPeriodCycle + bondIndex * BOND_GAP_CYCLES;
}

/** Burn height at which bond period `bondIndex` starts. Mirrors `bond-period-to-burn-height`. */
export function bondPeriodToBurnHeight(
	bondIndex: number,
	params: BondCycleParams,
): number {
	return rewardCycleToBurnHeight(
		bondPeriodToRewardCycle(bondIndex, params),
		params,
	);
}

/** First reward cycle in which bond `bondIndex`'s STX unlock (start + 12 cycles). */
export function bondUnlockCycle(
	bondIndex: number,
	params: BondCycleParams,
): number {
	return bondPeriodToRewardCycle(bondIndex, params) + BOND_LENGTH_CYCLES;
}

/**
 * Distribution-cycle index at `burnHeight` — distribution cycles are half a
 * reward cycle long. Mirrors `burn-height-to-distribution-index`.
 */
export function burnHeightToDistributionIndex(
	burnHeight: number,
	params: PoxCycleParams,
): number {
	return Math.floor(
		(burnHeight - params.firstBurnchainBlockHeight) /
			Math.floor(params.rewardCycleLength / 2),
	);
}

/**
 * Whether `burnHeight` falls in a cycle's prepare phase (the final
 * `prepareCycleLength` blocks). pox-5 rejects `unstake-sbtc` and
 * `announce-l1-early-exit` during a prepare phase.
 */
export function isInPreparePhase(
	burnHeight: number,
	params: PoxCycleParams & { prepareCycleLength: number },
): boolean {
	const offset =
		(burnHeight - params.firstBurnchainBlockHeight) % params.rewardCycleLength;
	return offset >= params.rewardCycleLength - params.prepareCycleLength;
}

export type BondPhase = "too-early" | "open" | "locked" | "unlocked";

/**
 * Coarse lifecycle phase of bond `bondIndex` at `burnHeight`: `too-early`
 * (before the bond's start is registerable), `open`/`locked` while active,
 * `unlocked` after 12 cycles.
 */
export function bondPhaseAtHeight(
	bondIndex: number,
	burnHeight: number,
	params: BondCycleParams,
): BondPhase {
	const cycle = burnHeightToRewardCycle(burnHeight, params);
	const start = bondPeriodToRewardCycle(bondIndex, params);
	const unlock = bondUnlockCycle(bondIndex, params);
	if (cycle < start - BOND_GAP_CYCLES) return "too-early";
	if (cycle < start) return "open";
	if (cycle < unlock) return "locked";
	return "unlocked";
}
