import { readContract } from "../actions/public/readContract.ts";
import {
	type CallContractParams,
	callContract,
} from "../actions/wallet/callContract.ts";
import type { ClarityValue } from "../clarity/types.ts";
import { Cl } from "../clarity/values.ts";
import type { Client } from "../clients/types.ts";
import type { IntegerType } from "../utils/encoding.ts";
import { POX5_CONTRACT_NAME } from "./constants.ts";

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

type TxOptions = Pick<
	CallContractParams,
	"fee" | "nonce" | "postConditions" | "postConditionMode"
>;

function call(
	client: Client,
	functionName: string,
	functionArgs: ClarityValue[],
	options: TxOptions = {},
): Promise<string> {
	return callContract(client, {
		contract: pox5ContractId(client),
		functionName,
		functionArgs,
		...options,
	});
}

function read(
	client: Client,
	functionName: string,
	functionArgs: ClarityValue[] = [],
): Promise<ClarityValue> {
	const [address, name] = pox5ContractId(client).split(".") as [string, string];
	return readContract(client, {
		contract: `${address}.${name}`,
		functionName,
		args: functionArgs,
	});
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

function bufferCV(input: Uint8Array | string): ClarityValue {
	return typeof input === "string" ? Cl.bufferFromHex(input) : Cl.buffer(input);
}

function btcLockupCV(lockup: BtcLockup): ClarityValue {
	if ("sbtcSats" in lockup) return Cl.error(Cl.uint(lockup.sbtcSats));
	return Cl.ok(
		Cl.tuple({
			outputs: Cl.list(
				lockup.l1Outputs.map((o) =>
					Cl.tuple({
						height: Cl.uint(o.height),
						tx: bufferCV(o.tx),
						"output-index": Cl.uint(o.outputIndex),
						header: bufferCV(o.header),
						"leaf-hashes": Cl.list(o.leafHashes.map(bufferCV)),
						"tx-count": Cl.uint(o.txCount),
						"tx-index": Cl.uint(o.txIndex),
						amount: Cl.uint(o.amount),
						"unlock-burn-height": Cl.uint(o.unlockBurnHeight),
					}),
				),
			),
			"staker-unlock-bytes": bufferCV(lockup.stakerUnlockBytes),
		}),
	);
}

function optionalBuffer(input?: Uint8Array | string): ClarityValue {
	return input === undefined ? Cl.none() : Cl.some(bufferCV(input));
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
	return call(
		client,
		"setup-bond",
		[
			Cl.uint(bondIndex),
			Cl.uint(targetRate),
			Cl.uint(stxValueRatio),
			Cl.uint(minUstxRatio),
			bufferCV(earlyUnlockBytes),
			Cl.list(
				allowlist.map((a) =>
					Cl.tuple({
						staker: Cl.principal(a.staker),
						"max-sats": Cl.uint(a.maxSats),
					}),
				),
			),
		],
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
	return call(
		client,
		"register-for-bond",
		[
			Cl.uint(bondIndex),
			Cl.principal(signerManager),
			Cl.uint(amountUstx),
			btcLockupCV(btcLockup),
			optionalBuffer(signerCalldata),
		],
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
	return call(
		client,
		"update-bond-registration",
		[
			Cl.principal(signerManager),
			Cl.principal(oldSignerManager),
			optionalBuffer(signerCalldata),
		],
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
	return call(
		client,
		"stake",
		[
			Cl.principal(signerManager),
			Cl.uint(amountUstx),
			Cl.uint(numCycles),
			Cl.uint(startBurnHeight),
			optionalBuffer(signerCalldata),
		],
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
	return call(
		client,
		"stake-update",
		[
			Cl.principal(signerManager),
			Cl.principal(oldSignerManager),
			Cl.uint(cyclesToExtend),
			Cl.uint(amountIncrease),
			optionalBuffer(signerCalldata),
		],
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
	return call(client, "unstake", [Cl.principal(oldSignerManager)], tx);
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
	return call(
		client,
		"unstake-sbtc",
		[Cl.principal(signerManager), Cl.uint(amountSats)],
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
	return call(
		client,
		"announce-l1-early-exit",
		[Cl.principal(staker), Cl.principal(oldSignerManager)],
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
	return call(
		client,
		"calculate-rewards",
		[Cl.list(bondPeriods.map((p) => Cl.uint(p)))],
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
	return call(
		client,
		"claim-rewards",
		[Cl.list(bondPeriods.map((p) => Cl.uint(p))), Cl.uint(rewardCycle)],
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
	return call(
		client,
		"claim-staker-rewards-for-signer",
		[
			Cl.principal(staker),
			Cl.uint(rewardCycle),
			bondIndex === undefined ? Cl.none() : Cl.some(Cl.uint(bondIndex)),
		],
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
	return call(
		client,
		"grant-signer-key",
		[
			bufferCV(signerKey),
			Cl.principal(signerManager),
			Cl.uint(authId),
			bufferCV(signerSig),
		],
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
	return call(
		client,
		"revoke-signer-grant",
		[Cl.principal(signerManager), bufferCV(signerKey)],
		tx,
	);
}

// ---------------------------------------------------------------------------
// Reads (raw ClarityValues — decode with the caller's ABI knowledge)
// ---------------------------------------------------------------------------

/** `get-staker-info` — lock dimensions + signer, `none` when expired/absent. */
export function getStakerInfo(
	client: Client,
	staker: string,
): Promise<ClarityValue> {
	return read(client, "get-staker-info", [Cl.principal(staker)]);
}

/** `get-bond-membership` — the staker's active bond membership, if any. */
export function getBondMembership(
	client: Client,
	staker: string,
): Promise<ClarityValue> {
	return read(client, "get-bond-membership", [Cl.principal(staker)]);
}

/** `get-protocol-bond` — a bond's core parameters. */
export function getProtocolBond(
	client: Client,
	bondIndex: IntegerType,
): Promise<ClarityValue> {
	return read(client, "get-protocol-bond", [Cl.uint(bondIndex)]);
}

/** `get-bond-allowance` — a staker's allowlisted max sats for a bond. */
export function getBondAllowance(
	client: Client,
	bondIndex: IntegerType,
	staker: string,
): Promise<ClarityValue> {
	return read(client, "get-bond-allowance", [
		Cl.uint(bondIndex),
		Cl.principal(staker),
	]);
}

/** `get-total-sbtc-staked-for-bond`. */
export function getTotalSbtcStakedForBond(
	client: Client,
	bondIndex: IntegerType,
): Promise<ClarityValue> {
	return read(client, "get-total-sbtc-staked-for-bond", [Cl.uint(bondIndex)]);
}

/** `get-staker-custodied-sbtc`. */
export function getStakerCustodiedSbtc(
	client: Client,
	staker: string,
): Promise<ClarityValue> {
	return read(client, "get-staker-custodied-sbtc", [Cl.principal(staker)]);
}

/** `has-announced-l1-early-exit`. */
export function hasAnnouncedL1EarlyExit(
	client: Client,
	bondIndex: IntegerType,
	staker: string,
): Promise<ClarityValue> {
	return read(client, "has-announced-l1-early-exit", [
		Cl.uint(bondIndex),
		Cl.principal(staker),
	]);
}

/** `get-bond-l1-unlock-height` — half a cycle before the bond period ends. */
export function getBondL1UnlockHeight(
	client: Client,
	bondIndex: IntegerType,
): Promise<ClarityValue> {
	return read(client, "get-bond-l1-unlock-height", [Cl.uint(bondIndex)]);
}

/** `get-signer-info`. */
export function getSignerInfo(
	client: Client,
	signer: string,
): Promise<ClarityValue> {
	return read(client, "get-signer-info", [Cl.principal(signer)]);
}

/** `verify-signer-key-grant` — whether a grant exists on-chain. */
export function verifySignerKeyGrantOnChain(
	client: Client,
	signerManager: string,
	signerKey: Uint8Array | string,
): Promise<ClarityValue> {
	return read(client, "verify-signer-key-grant", [
		Cl.principal(signerManager),
		bufferCV(signerKey),
	]);
}

/** `current-pox-reward-cycle`. */
export function getCurrentRewardCycle(client: Client): Promise<ClarityValue> {
	return read(client, "current-pox-reward-cycle");
}

/** `get-first-pox-5-reward-cycle`. */
export function getFirstPox5RewardCycle(client: Client): Promise<ClarityValue> {
	return read(client, "get-first-pox-5-reward-cycle");
}
