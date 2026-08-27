/**
 * Client-side pox-5 eligibility preflights. Rebuilds the contract's assert
 * chains from existing reads so callers can avoid burning fees on a known
 * abort.
 *
 * `reasons` is a **set**, not the on-chain abort order.
 *
 * Uncovered gates (Hiro skips these too — a preflight `{ ok: true }` is not
 * a guarantee the tx will land):
 * - `signer-manager-validate-stake!` (trait callback)
 * - L1 merkle proof (`ERR_INVALID_MERKLE_PROOF` u41)
 * - L1 lockup script match (`ERR_INVALID_LOCKUP_SCRIPT` u42)
 * - L1 lockup amount vs parsed tx (`ERR_INVALID_LOCKUP_AMOUNT` u45, except
 *   the empty-outputs case which we do flag)
 * - Bitcoin header / tx parse (`ERR_INVALID_BTC_HEADER` u40,
 *   `ERR_READ_TX_OUT_OF_BOUNDS` u39)
 *
 * These functions are never attached to wallet actions — call them
 * explicitly. Do not infer coverage of a gate from a missing reason.
 */

import { getBalance } from "../actions/public/getBalance.ts";
import { getDataVar } from "../actions/public/getDataVar.ts";
import { getMapEntry } from "../actions/public/getMapEntry.ts";
import type { ClarityValue } from "../clarity/types.ts";
import { Cl } from "../clarity/values.ts";
import type { Client } from "../clients/types.ts";
import {
	type IntegerType,
	bytesToHex,
	hexToBytes,
	intToBigInt,
} from "../utils/encoding.ts";
import {
	type BtcLockup,
	getBondAllowance,
	getBondL1UnlockHeight,
	getBondMembership,
	getEarned,
	getProtocolBond,
	getSignerInfo,
	getStakerInfo,
	pox5ContractId,
	verifySignerKeyGrantOnChain,
} from "./actions.ts";
import { getPoxInfo } from "./activation.ts";
import {
	BITCOIN_LOCKTIME_THRESHOLD,
	BOND_LENGTH_CYCLES,
	MAX_NUM_CYCLES,
	POX5_CONTRACT_NAME,
} from "./constants.ts";
import {
	type PoxCycleParams,
	bondPeriodToBurnHeight,
	bondPeriodToRewardCycle,
	burnHeightToRewardCycle,
	isInPreparePhase,
} from "./cycles.ts";
import { Pox5ErrorCode } from "./errors.ts";
import type { BondMembership, SignerInfo } from "./types.ts";

export type EligibilityResult =
	| { ok: true }
	| { ok: false; reasons: [Pox5ErrorCode, ...Pox5ErrorCode[]] };

export type EligibleStakeParams = {
	staker: string;
	signerManager: string;
	amountUstx: IntegerType;
	numCycles: IntegerType;
	startBurnHeight: IntegerType;
};

export type EligibleRegisterForBondParams = {
	staker: string;
	bondIndex: IntegerType;
	signerManager: string;
	amountUstx: IntegerType;
	btcLockup: BtcLockup;
};

export type EligibleUnstakeParams = {
	staker: string;
	oldSignerManager: string;
};

export type EligibleUnstakeSbtcParams = {
	staker: string;
	signerManager: string;
	amountSats: IntegerType;
};

export type EligibleClaimRewardsParams = {
	signer: string;
	rewardCycle: IntegerType;
	bondIndex?: IntegerType;
	bondPeriods?: IntegerType[];
};

export type EligibleGrantSignerKeyParams = {
	signerKey: Uint8Array | string;
	signerManager: string;
	authId: IntegerType;
};

export type EligibleAdminParams = {
	caller: string;
};

type CycleClock = {
	burnHeight: number;
	params: PoxCycleParams & { prepareCycleLength: number };
	firstBondPeriodCycle: number;
};

function finish(reasons: Pox5ErrorCode[]): EligibilityResult {
	const unique: Pox5ErrorCode[] = [];
	const seen = new Set<Pox5ErrorCode>();
	for (const code of reasons) {
		if (!seen.has(code)) {
			seen.add(code);
			unique.push(code);
		}
	}
	if (unique.length === 0) return { ok: true };
	return { ok: false, reasons: unique as [Pox5ErrorCode, ...Pox5ErrorCode[]] };
}

function toBytes(input: Uint8Array | string): Uint8Array {
	return typeof input === "string" ? hexToBytes(input) : input;
}

function outpointKey(
	tx: Uint8Array | string,
	outputIndex: IntegerType,
): string {
	const hex = typeof tx === "string" ? tx.toLowerCase() : bytesToHex(tx);
	return `${hex}:${intToBigInt(outputIndex)}`;
}

/**
 * Burn height from `getPoxInfo` (pox5/activation.ts, not frozen pox-4).
 * Cycle lengths are on `/v2/pox` but not mapped through `Pox5Info` — read
 * the same endpoint rather than guessing mainnet constants. Missing height
 * or lengths → `undefined` so callers fail closed instead of guessing.
 */
async function readCycleClock(client: Client): Promise<CycleClock | undefined> {
	const info = await getPoxInfo(client);
	const burnHeight = info.currentBurnchainBlockHeight;
	const first = info.firstBurnchainBlockHeight;
	const raw = (await client.request("/v2/pox", { method: "GET" })) as {
		reward_cycle_length?: number;
		prepare_cycle_length?: number;
	};
	const pox5 = info.contractVersions.find((v) =>
		v.contractId.endsWith(`.${POX5_CONTRACT_NAME}`),
	);
	if (
		typeof burnHeight !== "number" ||
		typeof first !== "number" ||
		typeof raw.reward_cycle_length !== "number" ||
		typeof raw.prepare_cycle_length !== "number" ||
		pox5 == null
	) {
		return undefined;
	}
	return {
		burnHeight,
		params: {
			firstBurnchainBlockHeight: first,
			rewardCycleLength: raw.reward_cycle_length,
			prepareCycleLength: raw.prepare_cycle_length,
		},
		firstBondPeriodCycle: pox5.firstRewardCycleId,
	};
}

function inPrepare(clock: CycleClock | undefined): boolean {
	if (!clock) return true;
	return isInPreparePhase(clock.burnHeight, clock.params);
}

async function signerReasons(
	client: Client,
	signerManager: string,
): Promise<Pox5ErrorCode[]> {
	const info: SignerInfo = await getSignerInfo(client, signerManager);
	if (info == null) return [Pox5ErrorCode.SignerNotFound];
	try {
		const granted = await verifySignerKeyGrantOnChain(
			client,
			signerManager,
			info,
		);
		if (!granted) return [Pox5ErrorCode.SignerKeyGrantNotFound];
	} catch {
		return [Pox5ErrorCode.SignerKeyGrantNotFound];
	}
	return [];
}

function bondOverlaps(
	membership: BondMembership,
	newFirstCycle: number,
	clock: CycleClock,
): boolean {
	if (!membership) return false;
	const start = bondPeriodToRewardCycle(Number(membership.bondIndex), {
		...clock.params,
		firstBondPeriodCycle: clock.firstBondPeriodCycle,
	});
	return start + BOND_LENGTH_CYCLES > newFirstCycle;
}

async function stxFloor(
	client: Client,
	staker: string,
	amountUstx: bigint,
): Promise<Pox5ErrorCode | undefined> {
	const balance = await getBalance(client, { address: staker });
	// `/v2/accounts` `balance` is unlocked STX. Rollover (locked+unlocked)
	// can still succeed on-chain when this flags InsufficientStx.
	if (balance < amountUstx) return Pox5ErrorCode.InsufficientStx;
	return undefined;
}

function principalValue(cv: ClarityValue): string | undefined {
	if (cv.type === "address" || cv.type === "contract") return cv.value;
	return undefined;
}

function minUstxForSats(
	sats: bigint,
	stxValueRatio: bigint,
	minUstxRatio: bigint,
): bigint {
	return (((stxValueRatio * sats) / 100n) * minUstxRatio) / 10_000n;
}

export async function eligibleStake(
	client: Client,
	params: EligibleStakeParams,
): Promise<EligibilityResult> {
	const reasons: Pox5ErrorCode[] = [];
	const amountUstx = intToBigInt(params.amountUstx);
	const numCycles = intToBigInt(params.numCycles);
	const startBurnHeight = intToBigInt(params.startBurnHeight);

	const [clock, stakerInfo, membership, signerErrs, floor] = await Promise.all([
		readCycleClock(client),
		getStakerInfo(client, params.staker),
		getBondMembership(client, params.staker),
		signerReasons(client, params.signerManager),
		stxFloor(client, params.staker, amountUstx),
	]);

	if (inPrepare(clock)) reasons.push(Pox5ErrorCode.StakeInPreparePhase);
	reasons.push(...signerErrs);
	if (floor !== undefined) reasons.push(floor);

	if (numCycles < 1n || numCycles > BigInt(MAX_NUM_CYCLES)) {
		reasons.push(Pox5ErrorCode.InvalidNumCycles);
	}

	if (clock) {
		const currentCycle = burnHeightToRewardCycle(
			clock.burnHeight,
			clock.params,
		);
		const firstRewardCycle = currentCycle + 1;
		const specified =
			burnHeightToRewardCycle(Number(startBurnHeight), clock.params) + 1;
		if (firstRewardCycle !== specified) {
			reasons.push(Pox5ErrorCode.InvalidStartBurnHeight);
		}
		if (stakerInfo) reasons.push(Pox5ErrorCode.AlreadyStaked);
		if (bondOverlaps(membership, firstRewardCycle, clock)) {
			reasons.push(Pox5ErrorCode.AlreadyStaked);
		}
		if (membership) {
			const unlock = await getBondL1UnlockHeight(client, membership.bondIndex);
			if (BigInt(clock.burnHeight) < unlock) {
				reasons.push(Pox5ErrorCode.RolloverTooEarly);
			}
		}
	} else if (stakerInfo) {
		reasons.push(Pox5ErrorCode.AlreadyStaked);
	}

	return finish(reasons);
}

export async function eligibleRegisterForBond(
	client: Client,
	params: EligibleRegisterForBondParams,
): Promise<EligibilityResult> {
	const reasons: Pox5ErrorCode[] = [];
	const amountUstx = intToBigInt(params.amountUstx);
	const lockup = params.btcLockup;

	let sats = 0n;
	if ("sbtcSats" in lockup) {
		sats = intToBigInt(lockup.sbtcSats);
	} else {
		if (lockup.l1Outputs.length === 0) {
			reasons.push(Pox5ErrorCode.InvalidLockupAmount);
		}
		const seen = new Set<string>();
		for (const output of lockup.l1Outputs) {
			sats += intToBigInt(output.amount);
			const key = outpointKey(output.tx, output.outputIndex);
			if (seen.has(key)) reasons.push(Pox5ErrorCode.DuplicateLockupOutpoint);
			seen.add(key);
		}
	}

	const [clock, stakerInfo, membership, bond, allowance, signerErrs, floor] =
		await Promise.all([
			readCycleClock(client),
			getStakerInfo(client, params.staker),
			getBondMembership(client, params.staker),
			getProtocolBond(client, params.bondIndex),
			getBondAllowance(client, params.bondIndex, params.staker),
			signerReasons(client, params.signerManager),
			stxFloor(client, params.staker, amountUstx),
		]);

	if (inPrepare(clock)) reasons.push(Pox5ErrorCode.StakeInPreparePhase);
	reasons.push(...signerErrs);
	if (floor !== undefined) reasons.push(floor);

	if (!bond) reasons.push(Pox5ErrorCode.BondNotFound);
	if (allowance == null) reasons.push(Pox5ErrorCode.NotAllowlisted);
	else if (sats > allowance) reasons.push(Pox5ErrorCode.TooMuchSats);

	if (bond) {
		const min = minUstxForSats(sats, bond.stxValueRatio, bond.minUstxRatio);
		if (amountUstx < min) reasons.push(Pox5ErrorCode.InsufficientStx);
	}

	if (clock) {
		const bondStart = bondPeriodToBurnHeight(
			Number(intToBigInt(params.bondIndex)),
			{
				...clock.params,
				firstBondPeriodCycle: clock.firstBondPeriodCycle,
			},
		);
		if (clock.burnHeight >= bondStart) {
			reasons.push(Pox5ErrorCode.BondAlreadyStarted);
		}
		const firstRewardCycle = bondPeriodToRewardCycle(
			Number(intToBigInt(params.bondIndex)),
			{ ...clock.params, firstBondPeriodCycle: clock.firstBondPeriodCycle },
		);
		if (stakerInfo) {
			const unlockCycle =
				Number(stakerInfo.firstRewardCycle) + Number(stakerInfo.numCycles);
			if (unlockCycle > firstRewardCycle) {
				reasons.push(Pox5ErrorCode.AlreadyStaked);
			}
		}
		if (bondOverlaps(membership, firstRewardCycle, clock)) {
			reasons.push(Pox5ErrorCode.AlreadyRegistered);
		}
		if (membership) {
			const unlock = await getBondL1UnlockHeight(client, membership.bondIndex);
			if (BigInt(clock.burnHeight) < unlock) {
				reasons.push(Pox5ErrorCode.RolloverTooEarly);
			}
		}
	}

	if ("l1Outputs" in lockup && lockup.l1Outputs.length > 0) {
		const minUnlock = await getBondL1UnlockHeight(client, params.bondIndex);
		for (const output of lockup.l1Outputs) {
			const height = intToBigInt(output.unlockBurnHeight);
			if (height < minUnlock || height >= BITCOIN_LOCKTIME_THRESHOLD) {
				reasons.push(Pox5ErrorCode.InvalidUnlockHeight);
			}
		}
	}

	return finish(reasons);
}

export async function eligibleUnstake(
	client: Client,
	params: EligibleUnstakeParams,
): Promise<EligibilityResult> {
	const reasons: Pox5ErrorCode[] = [];
	const [clock, stakerInfo] = await Promise.all([
		readCycleClock(client),
		getStakerInfo(client, params.staker),
	]);
	if (inPrepare(clock)) reasons.push(Pox5ErrorCode.UnstakeInPreparePhase);
	if (!stakerInfo) reasons.push(Pox5ErrorCode.NotStaking);
	else if (stakerInfo.signer !== params.oldSignerManager) {
		reasons.push(Pox5ErrorCode.InvalidOldSignerManager);
	}
	return finish(reasons);
}

export async function eligibleUnstakeSbtc(
	client: Client,
	params: EligibleUnstakeSbtcParams,
): Promise<EligibilityResult> {
	const reasons: Pox5ErrorCode[] = [];
	const amount = intToBigInt(params.amountSats);
	const [clock, membership] = await Promise.all([
		readCycleClock(client),
		getBondMembership(client, params.staker),
	]);
	// unstake-sbtc uses verify-not-prepare-phase → ERR_STAKE_IN_PREPARE_PHASE
	if (inPrepare(clock)) reasons.push(Pox5ErrorCode.StakeInPreparePhase);
	if (!membership) reasons.push(Pox5ErrorCode.NotBondParticipant);
	else {
		if (membership.signer !== params.signerManager) {
			reasons.push(Pox5ErrorCode.InvalidOldSignerManager);
		}
		if (membership.isL1Lock) reasons.push(Pox5ErrorCode.CannotUnstakeSbtc);
		if (amount > membership.amountSats) {
			reasons.push(Pox5ErrorCode.InvalidUnstakeSbtcAmount);
		}
	}
	return finish(reasons);
}

export async function eligibleClaimRewards(
	client: Client,
	params: EligibleClaimRewardsParams,
): Promise<EligibilityResult> {
	const reasons: Pox5ErrorCode[] = [];
	const contract = pox5ContractId(client);
	const paused = await getDataVar(client, {
		contract,
		varName: "rewards-paused",
	});
	if (paused.type === "true") reasons.push(Pox5ErrorCode.RewardsPaused);

	const periods = params.bondPeriods ?? [];
	const earnedParts = await Promise.all([
		getEarned(client, {
			signer: params.signer,
			rewardCycle: params.rewardCycle,
			bondIndex: params.bondIndex,
		}),
		...periods.map((bondIndex) =>
			getEarned(client, {
				signer: params.signer,
				rewardCycle: params.rewardCycle,
				bondIndex,
			}),
		),
	]);
	let total = 0n;
	for (const part of earnedParts) total += part;
	if (total === 0n) reasons.push(Pox5ErrorCode.NoClaimableRewards);

	return finish(reasons);
}

export async function eligibleGrantSignerKey(
	client: Client,
	params: EligibleGrantSignerKeyParams,
): Promise<EligibilityResult> {
	const reasons: Pox5ErrorCode[] = [];
	const used = await getMapEntry(client, {
		contract: pox5ContractId(client),
		mapName: "used-signer-key-grants",
		key: Cl.tuple({
			"signer-key": Cl.buffer(toBytes(params.signerKey)),
			"signer-manager": Cl.principal(params.signerManager),
			"auth-id": Cl.uint(intToBigInt(params.authId)),
		}),
	});
	if (used.type === "some") reasons.push(Pox5ErrorCode.SignerKeyGrantUsed);
	return finish(reasons);
}

export async function eligibleSetBondAdmin(
	client: Client,
	params: EligibleAdminParams,
): Promise<EligibilityResult> {
	const admin = await getDataVar(client, {
		contract: pox5ContractId(client),
		varName: "bond-admin",
	});
	if (principalValue(admin) !== params.caller) {
		return finish([Pox5ErrorCode.Unauthorized]);
	}
	return { ok: true };
}

export async function eligiblePauseRewards(
	client: Client,
	params: EligibleAdminParams,
): Promise<EligibilityResult> {
	const admin = await getDataVar(client, {
		contract: pox5ContractId(client),
		varName: "pause-admin",
	});
	if (principalValue(admin) !== params.caller) {
		return finish([Pox5ErrorCode.Unauthorized]);
	}
	return { ok: true };
}
