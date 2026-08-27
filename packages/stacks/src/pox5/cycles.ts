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
 * Minimum L1 CLTV height for bond `bondIndex` — half a cycle before the
 * bond period ends. Mirrors `get-bond-l1-unlock-height`. Distinct from
 * {@link bondUnlockCycle} (the STX unlock cycle).
 */
export function computeBondUnlockHeight(
	bondIndex: number,
	params: BondCycleParams,
): number {
	const endCycle = bondPeriodToRewardCycle(
		bondIndex + BOND_LENGTH_CYCLES / BOND_GAP_CYCLES,
		params,
	);
	return (
		rewardCycleToBurnHeight(endCycle, params) -
		Math.floor(params.rewardCycleLength / 2)
	);
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

/** Burn height at the start of `distIndex`. Mirrors `distribution-cycle-to-burn-height`. */
export function distributionCycleToBurnHeight(
	distIndex: number,
	params: PoxCycleParams,
): number {
	return (
		params.firstBurnchainBlockHeight +
		distIndex * Math.floor(params.rewardCycleLength / 2)
	);
}

/**
 * Distribution cycle containing `burnHeight`. Named after the contract's
 * `current-distribution-cycle` but takes height as an argument — no clock.
 */
export function currentDistributionCycle(
	burnHeight: number,
	params: PoxCycleParams,
): number {
	return burnHeightToDistributionIndex(burnHeight, params);
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

/**
 * Prepare-aware bond lifecycle. `open` is the registerable window — it
 * ends when the start cycle's prepare phase begins (`register-for-bond`
 * then fails with `ERR_STAKE_IN_PREPARE_PHASE`). Coarse cycle buckets
 * (whole pre-start cycle as `open`) stay on {@link BondPhase}.
 *
 * `eligible`/`missed`/`finished` are omitted: they are not contract
 * states (registration is height-gated, not a per-staker enum).
 */
export type BondStatusName = "too-early" | "open" | "locked" | "unlocked";

export function bondStatusAtHeight(
	bondIndex: number,
	burnHeight: number,
	params: BondCycleParams & { prepareCycleLength: number },
): BondStatusName {
	const cycle = burnHeightToRewardCycle(burnHeight, params);
	const start = bondPeriodToRewardCycle(bondIndex, params);
	const unlock = bondUnlockCycle(bondIndex, params);
	if (cycle < start - BOND_GAP_CYCLES) return "too-early";
	if (cycle < start) {
		// Prepare of the start cycle (last prepareCycleLength blocks of
		// cycle start-1) permanently closes registration. Other prepares
		// in the window still report `open`; st-022 layers isInPreparePhase.
		if (cycle === start - 1 && isInPreparePhase(burnHeight, params)) {
			return "locked";
		}
		return "open";
	}
	if (cycle < unlock) return "locked";
	return "unlocked";
}
