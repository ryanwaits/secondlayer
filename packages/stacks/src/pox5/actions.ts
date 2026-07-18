import { getContract } from "../actions/getContract.ts";
import type { FeeParam } from "../actions/wallet/utils.ts";
import type { Client } from "../clients/types.ts";
import type { PostCondition } from "../postconditions/types.ts";
import {
	type IntegerType,
	hexToBytes,
	intToBigInt,
} from "../utils/encoding.ts";
import { POX5_ABI } from "./abi.ts";
import { POX5_CONTRACT_NAME } from "./constants.ts";
import type {
	BondAllowance,
	BondMembership,
	ProtocolBond,
	SignerInfo,
	StakerInfo,
} from "./types.ts";

/**
 * PoX-5 contract calls and reads, pinned against the final contract in
 * stacks-core 4.0.0. Wallet actions route through `callContract`, so they
 * inherit fee tiers, nonce management, and typed broadcast errors; pair the
 * returned txid with `waitForTransactionReceipt` to await inclusion.
 *
 * Note: pox-5 uses `contract-caller`/`tx-sender` directly (there is no
 * `allow-contract-caller` indirection like pox-4). Amount/lock safety is
 * expressed with the new Epoch 4.0 `Staking`/`Pox` post-conditions — pass
 * them via `postConditions` on any of these actions.
 */

/** Resolve the boot `pox-5` contract id for the client's chain. */
export function pox5ContractId(client: Client): string {
	const boot = client.chain?.bootAddress;
	if (!boot) throw new Error("Client must have a chain with a bootAddress");
	return `${boot}.${POX5_CONTRACT_NAME}`;
}

type TxOptions = {
	fee?: FeeParam;
	nonce?: IntegerType;
	postConditions?: PostCondition[];
	postConditionMode?: "allow" | "deny";
};

function getPox5Contract(client: Client) {
	const [address, name] = pox5ContractId(client).split(".") as [string, string];
	return getContract({ client, address, name, abi: POX5_ABI });
}

// ---------------------------------------------------------------------------
// L1 BTC lockup proof shape (register-for-bond's ok-branch outputs)
// ---------------------------------------------------------------------------

/**
 * One proven L1 timelock output — a Bitcoin SPV inclusion proof of the lockup
 * tx plus which output is the lockup. `@secondlayer/stacks/bitcoin`'s
 * `buildTxProof` produces the proof fields.
 */
export type L1LockupOutput = {
	/** Burn height of the Bitcoin block containing the lockup tx. */
	height: IntegerType;
	/** Raw Bitcoin tx (witness-stripped), hex or bytes. */
	tx: Uint8Array | string;
	outputIndex: IntegerType;
	/** 80-byte Bitcoin block header. */
	header: Uint8Array | string;
	/** Merkle siblings, leaf→root (max 14). */
	leafHashes: Array<Uint8Array | string>;
	txCount: IntegerType;
	txIndex: IntegerType;
	/** Output value in sats. */
	amount: IntegerType;
	unlockBurnHeight: IntegerType;
};

/** BTC side of a bond registration: proven L1 lockups, or an sBTC amount. */
export type BtcLockup =
	| { l1Outputs: L1LockupOutput[]; stakerUnlockBytes: Uint8Array | string }
	| { sbtcSats: IntegerType };

/** ABI buff args take `Uint8Array`; hex strings decode exactly like `Cl.bufferFromHex`. */
function toBytes(input: Uint8Array | string): Uint8Array {
	return typeof input === "string" ? hexToBytes(input) : input;
}

/** ABI `(optional (buff …))` args are required-with-null. */
function optionalBytes(input?: Uint8Array | string): Uint8Array | null {
	return input === undefined ? null : toBytes(input);
}

/** Map `BtcLockup` to the ABI's `(response (tuple …) uint)` arg shape. */
function btcLockupArg(lockup: BtcLockup) {
	if ("sbtcSats" in lockup) return { err: intToBigInt(lockup.sbtcSats) };
	return {
		ok: {
			outputs: lockup.l1Outputs.map((o) => ({
				height: intToBigInt(o.height),
				tx: toBytes(o.tx),
				outputIndex: intToBigInt(o.outputIndex),
				header: toBytes(o.header),
				leafHashes: o.leafHashes.map(toBytes),
				txCount: intToBigInt(o.txCount),
				txIndex: intToBigInt(o.txIndex),
				amount: intToBigInt(o.amount),
				unlockBurnHeight: intToBigInt(o.unlockBurnHeight),
			})),
			stakerUnlockBytes: toBytes(lockup.stakerUnlockBytes),
		},
	};
}

// ---------------------------------------------------------------------------
// Wallet actions (broadcast a pox-5 contract call, return the txid)
// ---------------------------------------------------------------------------

export type SetupBondParams = TxOptions & {
	bondIndex: IntegerType;
	/** Target yield rate, basis points. */
	targetRate: IntegerType;
	/** µSTX per 100 sats (BTCUSD / STXUSD representation). */
	stxValueRatio: IntegerType;
	/** Minimum locked STX relative to BTC, basis points. */
	minUstxRatio: IntegerType;
	/** Early-unlock subscript for this bond's L1 lockup scripts (max 683B). */
	earlyUnlockBytes: Uint8Array | string;
	allowlist: Array<{ staker: string; maxSats: IntegerType }>;
};

/** `setup-bond` — bond-admin only. */
export function setupBond(
	client: Client,
	params: SetupBondParams,
): Promise<string> {
	const {
		bondIndex,
		targetRate,
		stxValueRatio,
		minUstxRatio,
		earlyUnlockBytes,
		allowlist,
		...tx
	} = params;
	return getPox5Contract(client).call.setupBond(
		{
			bondIndex: intToBigInt(bondIndex),
			targetRate: intToBigInt(targetRate),
			stxValueRatio: intToBigInt(stxValueRatio),
			minUstxRatio: intToBigInt(minUstxRatio),
			earlyUnlockBytes: toBytes(earlyUnlockBytes),
			allowlist: allowlist.map((a) => ({
				staker: a.staker,
				maxSats: intToBigInt(a.maxSats),
			})),
		},
		tx,
	);
}

export type RegisterForBondParams = TxOptions & {
	bondIndex: IntegerType;
	/** Signer-manager contract principal. */
	signerManager: string;
	amountUstx: IntegerType;
	btcLockup: BtcLockup;
	signerCalldata?: Uint8Array | string;
};

/** `register-for-bond` — join a bond with proven L1 lockups or sBTC. */
export function registerForBond(
	client: Client,
	params: RegisterForBondParams,
): Promise<string> {
	const {
		bondIndex,
		signerManager,
		amountUstx,
		btcLockup,
		signerCalldata,
		...tx
	} = params;
	return getPox5Contract(client).call.registerForBond(
		{
			bondIndex: intToBigInt(bondIndex),
			signerManager,
			amountUstx: intToBigInt(amountUstx),
			btcLockup: btcLockupArg(btcLockup),
			signerCalldata: optionalBytes(signerCalldata),
		},
		tx,
	);
}

export type UpdateBondRegistrationParams = TxOptions & {
	signerManager: string;
	oldSignerManager: string;
	signerCalldata?: Uint8Array | string;
};

/** `update-bond-registration` — switch signer-managers mid-bond. */
export function updateBondRegistration(
	client: Client,
	params: UpdateBondRegistrationParams,
): Promise<string> {
	const { signerManager, oldSignerManager, signerCalldata, ...tx } = params;
	return getPox5Contract(client).call.updateBondRegistration(
		{
			signerManager,
			oldSignerManager,
			signerCalldata: optionalBytes(signerCalldata),
		},
		tx,
	);
}

export type StakeParams = TxOptions & {
	signerManager: string;
	amountUstx: IntegerType;
	numCycles: IntegerType;
	startBurnHeight: IntegerType;
	signerCalldata?: Uint8Array | string;
};

/** `stake` — STX-only staking. */
export function stake(client: Client, params: StakeParams): Promise<string> {
	const {
		signerManager,
		amountUstx,
		numCycles,
		startBurnHeight,
		signerCalldata,
		...tx
	} = params;
	return getPox5Contract(client).call.stake(
		{
			signerManager,
			amountUstx: intToBigInt(amountUstx),
			numCycles: intToBigInt(numCycles),
			startBurnHt: intToBigInt(startBurnHeight),
			signerCalldata: optionalBytes(signerCalldata),
		},
		tx,
	);
}

export type StakeUpdateParams = TxOptions & {
	signerManager: string;
	oldSignerManager: string;
	cyclesToExtend: IntegerType;
	amountIncrease: IntegerType;
	signerCalldata?: Uint8Array | string;
};

/** `stake-update` — extend and/or increase an STX-only position. */
export function stakeUpdate(
	client: Client,
	params: StakeUpdateParams,
): Promise<string> {
	const {
		signerManager,
		oldSignerManager,
		cyclesToExtend,
		amountIncrease,
		signerCalldata,
		...tx
	} = params;
	return getPox5Contract(client).call.stakeUpdate(
		{
			signerManager,
			oldSignerManager,
			cyclesToExtend: intToBigInt(cyclesToExtend),
			amountIncrease: intToBigInt(amountIncrease),
			signerCalldata: optionalBytes(signerCalldata),
		},
		tx,
	);
}

export type UnstakeParams = TxOptions & { oldSignerManager: string };

/** `unstake` — wind down an STX-only position at the next cycle. */
export function unstake(
	client: Client,
	params: UnstakeParams,
): Promise<string> {
	const { oldSignerManager, ...tx } = params;
	return getPox5Contract(client).call.unstake({ oldSignerManager }, tx);
}

export type UnstakeSbtcParams = TxOptions & {
	signerManager: string;
	amountSats: IntegerType;
};

/** `unstake-sbtc` — withdraw custodied sBTC from a bond (rejected in prepare phase). */
export function unstakeSbtc(
	client: Client,
	params: UnstakeSbtcParams,
): Promise<string> {
	const { signerManager, amountSats, ...tx } = params;
	return getPox5Contract(client).call.unstakeSbtc(
		{ signerManager, amountToWithdrawalSats: intToBigInt(amountSats) },
		tx,
	);
}

export type AnnounceL1EarlyExitParams = TxOptions & {
	staker: string;
	oldSignerManager: string;
};

/** `announce-l1-early-exit` — staker-callable since 4.0.0 (rejected in prepare phase). */
export function announceL1EarlyExit(
	client: Client,
	params: AnnounceL1EarlyExitParams,
): Promise<string> {
	const { staker, oldSignerManager, ...tx } = params;
	return getPox5Contract(client).call.announceL1EarlyExit(
		{ staker, oldSignerManager },
		tx,
	);
}

export type CalculateRewardsParams = TxOptions & {
	bondPeriods: IntegerType[];
};

/** `calculate-rewards` — settle the reward accounting for up to 6 bond periods. */
export function calculateRewards(
	client: Client,
	params: CalculateRewardsParams,
): Promise<string> {
	const { bondPeriods, ...tx } = params;
	return getPox5Contract(client).call.calculateRewards(
		{ bondPeriods: bondPeriods.map(intToBigInt) },
		tx,
	);
}

export type ClaimRewardsParams = TxOptions & {
	bondPeriods: IntegerType[];
	rewardCycle: IntegerType;
};

/** `claim-rewards` — signer-manager claims accrued rewards for a cycle. */
export function claimRewards(
	client: Client,
	params: ClaimRewardsParams,
): Promise<string> {
	const { bondPeriods, rewardCycle, ...tx } = params;
	return getPox5Contract(client).call.claimRewards(
		{
			bondPeriods: bondPeriods.map(intToBigInt),
			rewardCycle: intToBigInt(rewardCycle),
		},
		tx,
	);
}

export type ClaimStakerRewardsForSignerParams = TxOptions & {
	staker: string;
	rewardCycle: IntegerType;
	bondIndex?: IntegerType;
};

/** `claim-staker-rewards-for-signer`. */
export function claimStakerRewardsForSigner(
	client: Client,
	params: ClaimStakerRewardsForSignerParams,
): Promise<string> {
	const { staker, rewardCycle, bondIndex, ...tx } = params;
	return getPox5Contract(client).call.claimStakerRewardsForSigner(
		{
			staker,
			rewardCycle: intToBigInt(rewardCycle),
			bondIndex: bondIndex === undefined ? null : intToBigInt(bondIndex),
		},
		tx,
	);
}

export type GrantSignerKeyParams = TxOptions & {
	/** 33-byte compressed signer key. */
	signerKey: Uint8Array | string;
	signerManager: string;
	authId: IntegerType;
	/** 65-byte RSV signature from `signSignerGrant`. */
	signerSig: Uint8Array | string;
};

/** `grant-signer-key` — callable by the signer-manager contract itself. */
export function grantSignerKey(
	client: Client,
	params: GrantSignerKeyParams,
): Promise<string> {
	const { signerKey, signerManager, authId, signerSig, ...tx } = params;
	return getPox5Contract(client).call.grantSignerKey(
		{
			signerKey: toBytes(signerKey),
			signerManager,
			authId: intToBigInt(authId),
			signerSig: toBytes(signerSig),
		},
		tx,
	);
}

export type RevokeSignerGrantParams = TxOptions & {
	signerManager: string;
	signerKey: Uint8Array | string;
};

/** `revoke-signer-grant`. */
export function revokeSignerGrant(
	client: Client,
	params: RevokeSignerGrantParams,
): Promise<string> {
	const { signerManager, signerKey, ...tx } = params;
	return getPox5Contract(client).call.revokeSignerGrant(
		{ signerManager, signerKey: toBytes(signerKey) },
		tx,
	);
}

// ---------------------------------------------------------------------------
// Reads (JS-mapped return types — see types.ts)
// ---------------------------------------------------------------------------

/** `get-staker-info` — lock dimensions + signer, `none` when expired/absent. */
export async function getStakerInfo(
	client: Client,
	staker: string,
): Promise<StakerInfo> {
	return (await getPox5Contract(client).read.getStakerInfo({
		staker,
	})) as StakerInfo;
}

/** `get-bond-membership` — the staker's active bond membership, if any. */
export async function getBondMembership(
	client: Client,
	staker: string,
): Promise<BondMembership> {
	return (await getPox5Contract(client).read.getBondMembership({
		staker,
	})) as BondMembership;
}

/** `get-protocol-bond` — a bond's core parameters. */
export async function getProtocolBond(
	client: Client,
	bondIndex: IntegerType,
): Promise<ProtocolBond> {
	return (await getPox5Contract(client).read.getProtocolBond({
		bondIndex: intToBigInt(bondIndex),
	})) as ProtocolBond;
}

/** `get-bond-allowance` — a staker's allowlisted max sats for a bond. */
export async function getBondAllowance(
	client: Client,
	bondIndex: IntegerType,
	staker: string,
): Promise<BondAllowance> {
	return (await getPox5Contract(client).read.getBondAllowance({
		bondIndex: intToBigInt(bondIndex),
		staker,
	})) as BondAllowance;
}

/** `get-total-sbtc-staked-for-bond`. */
export function getTotalSbtcStakedForBond(
	client: Client,
	bondIndex: IntegerType,
): Promise<bigint> {
	return getPox5Contract(client).read.getTotalSbtcStakedForBond({
		bondIndex: intToBigInt(bondIndex),
	});
}

/** `get-staker-custodied-sbtc`. */
export function getStakerCustodiedSbtc(
	client: Client,
	staker: string,
): Promise<bigint> {
	return getPox5Contract(client).read.getStakerCustodiedSbtc({ staker });
}

/** `has-announced-l1-early-exit`. */
export function hasAnnouncedL1EarlyExit(
	client: Client,
	bondIndex: IntegerType,
	staker: string,
): Promise<boolean> {
	return getPox5Contract(client).read.hasAnnouncedL1EarlyExit({
		bondIndex: intToBigInt(bondIndex),
		staker,
	});
}

/** `get-bond-l1-unlock-height` — half a cycle before the bond period ends. */
export function getBondL1UnlockHeight(
	client: Client,
	bondIndex: IntegerType,
): Promise<bigint> {
	return getPox5Contract(client).read.getBondL1UnlockHeight({
		bondIndex: intToBigInt(bondIndex),
	});
}

/** `get-signer-info`. */
export async function getSignerInfo(
	client: Client,
	signer: string,
): Promise<SignerInfo> {
	return (await getPox5Contract(client).read.getSignerInfo({
		signer,
	})) as SignerInfo;
}

/** `verify-signer-key-grant` — whether a grant exists on-chain. */
export function verifySignerKeyGrantOnChain(
	client: Client,
	signerManager: string,
	signerKey: Uint8Array | string,
): Promise<boolean> {
	return getPox5Contract(client).read.verifySignerKeyGrant({
		signerManager,
		signerKey: toBytes(signerKey),
	});
}

/** `current-pox-reward-cycle`. */
export function getCurrentRewardCycle(client: Client): Promise<bigint> {
	return getPox5Contract(client).read.currentPoxRewardCycle({});
}

/** `get-first-pox-5-reward-cycle`. */
export function getFirstPox5RewardCycle(client: Client): Promise<bigint> {
	return getPox5Contract(client).read.getFirstPox5RewardCycle({});
}
