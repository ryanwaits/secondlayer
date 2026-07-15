import { multicall } from "../actions/public/multicall.ts";
import type { ClarityValue } from "../clarity/types.ts";
import { Cl } from "../clarity/values.ts";
import type { Client } from "../clients/types.ts";
import type { IntegerType } from "../utils/encoding.ts";
import {
	type AnnounceL1EarlyExitParams,
	type CalculateRewardsParams,
	type ClaimRewardsParams,
	type ClaimStakerRewardsForSignerParams,
	type GrantSignerKeyParams,
	type RegisterForBondParams,
	type RevokeSignerGrantParams,
	type SetupBondParams,
	type StakeParams,
	type StakeUpdateParams,
	type UnstakeParams,
	type UnstakeSbtcParams,
	type UpdateBondRegistrationParams,
	announceL1EarlyExit,
	calculateRewards,
	claimRewards,
	claimStakerRewardsForSigner,
	getBondAllowance,
	getBondL1UnlockHeight,
	getBondMembership,
	getCurrentRewardCycle,
	getFirstPox5RewardCycle,
	getProtocolBond,
	getSignerInfo,
	getStakerCustodiedSbtc,
	getStakerInfo,
	getTotalSbtcStakedForBond,
	grantSignerKey,
	hasAnnouncedL1EarlyExit,
	pox5ContractId,
	registerForBond,
	revokeSignerGrant,
	setupBond,
	stake,
	stakeUpdate,
	unstake,
	unstakeSbtc,
	updateBondRegistration,
	verifySignerKeyGrantOnChain,
} from "./actions.ts";
import {
	type Pox5Activation,
	getPox5Activation,
	isPox5Active,
} from "./activation.ts";

/**
 * A staker's whole PoX-5 position in ONE batched request: staker info, bond
 * membership, custodied sBTC, and the current cycle — the state a dashboard
 * or agent polls, without four round-trips.
 */
export type StakerState = {
	stakerInfo: ClarityValue;
	bondMembership: ClarityValue;
	custodiedSbtc: ClarityValue;
	currentCycle: ClarityValue;
};

async function getStakerState(
	client: Client,
	staker: string,
): Promise<StakerState> {
	const contract = pox5ContractId(client);
	const results = await multicall(client, {
		allowFailure: false,
		calls: [
			{
				contract,
				functionName: "get-staker-info",
				args: [Cl.principal(staker)],
			},
			{
				contract,
				functionName: "get-bond-membership",
				args: [Cl.principal(staker)],
			},
			{
				contract,
				functionName: "get-staker-custodied-sbtc",
				args: [Cl.principal(staker)],
			},
			{ contract, functionName: "current-pox-reward-cycle", args: [] },
		],
	});
	const [stakerInfo, bondMembership, custodiedSbtc, currentCycle] =
		results as ClarityValue[];
	return {
		stakerInfo: stakerInfo as ClarityValue,
		bondMembership: bondMembership as ClarityValue,
		custodiedSbtc: custodiedSbtc as ClarityValue,
		currentCycle: currentCycle as ClarityValue,
	};
}

/** Actions provided by the pox5 extension. */
export type Pox5Actions = {
	pox5: {
		// activation
		isActive: () => Promise<boolean>;
		getActivation: () => Promise<Pox5Activation | undefined>;
		contractId: () => string;
		// batched state
		getStakerState: (staker: string) => Promise<StakerState>;
		// reads
		getStakerInfo: (staker: string) => Promise<ClarityValue>;
		getBondMembership: (staker: string) => Promise<ClarityValue>;
		getProtocolBond: (bondIndex: IntegerType) => Promise<ClarityValue>;
		getBondAllowance: (
			bondIndex: IntegerType,
			staker: string,
		) => Promise<ClarityValue>;
		getTotalSbtcStakedForBond: (
			bondIndex: IntegerType,
		) => Promise<ClarityValue>;
		getStakerCustodiedSbtc: (staker: string) => Promise<ClarityValue>;
		hasAnnouncedL1EarlyExit: (
			bondIndex: IntegerType,
			staker: string,
		) => Promise<ClarityValue>;
		getBondL1UnlockHeight: (bondIndex: IntegerType) => Promise<ClarityValue>;
		getSignerInfo: (signer: string) => Promise<ClarityValue>;
		verifySignerKeyGrant: (
			signerManager: string,
			signerKey: Uint8Array | string,
		) => Promise<ClarityValue>;
		getCurrentRewardCycle: () => Promise<ClarityValue>;
		getFirstRewardCycle: () => Promise<ClarityValue>;
		// wallet actions (txids; pair with waitForTransactionReceipt)
		setupBond: (params: SetupBondParams) => Promise<string>;
		registerForBond: (params: RegisterForBondParams) => Promise<string>;
		updateBondRegistration: (
			params: UpdateBondRegistrationParams,
		) => Promise<string>;
		stake: (params: StakeParams) => Promise<string>;
		stakeUpdate: (params: StakeUpdateParams) => Promise<string>;
		unstake: (params: UnstakeParams) => Promise<string>;
		unstakeSbtc: (params: UnstakeSbtcParams) => Promise<string>;
		announceL1EarlyExit: (params: AnnounceL1EarlyExitParams) => Promise<string>;
		calculateRewards: (params: CalculateRewardsParams) => Promise<string>;
		claimRewards: (params: ClaimRewardsParams) => Promise<string>;
		claimStakerRewardsForSigner: (
			params: ClaimStakerRewardsForSignerParams,
		) => Promise<string>;
		grantSignerKey: (params: GrantSignerKeyParams) => Promise<string>;
		revokeSignerGrant: (params: RevokeSignerGrantParams) => Promise<string>;
	};
};

/**
 * PoX-5 extension for the Stacks client.
 *
 * @example
 * const client = createWalletClient({ chain: mainnet, transport: http(), account })
 *   .extend(pox5());
 *
 * if (await client.pox5.isActive()) {
 *   const txid = await client.pox5.stake({
 *     signerManager: "SP…​.signer-mgr",
 *     amountUstx: 100_000_000_000n,
 *     numCycles: 12,
 *     startBurnHeight: 960_231,
 *     fee: "low",
 *   });
 *   await client.waitForTransactionReceipt({ txid });
 * }
 */
export function pox5(): (client: Client) => Pox5Actions {
	return (client: Client) => ({
		pox5: {
			isActive: () => isPox5Active(client),
			getActivation: () => getPox5Activation(client),
			contractId: () => pox5ContractId(client),
			getStakerState: (staker) => getStakerState(client, staker),
			getStakerInfo: (staker) => getStakerInfo(client, staker),
			getBondMembership: (staker) => getBondMembership(client, staker),
			getProtocolBond: (bondIndex) => getProtocolBond(client, bondIndex),
			getBondAllowance: (bondIndex, staker) =>
				getBondAllowance(client, bondIndex, staker),
			getTotalSbtcStakedForBond: (bondIndex) =>
				getTotalSbtcStakedForBond(client, bondIndex),
			getStakerCustodiedSbtc: (staker) =>
				getStakerCustodiedSbtc(client, staker),
			hasAnnouncedL1EarlyExit: (bondIndex, staker) =>
				hasAnnouncedL1EarlyExit(client, bondIndex, staker),
			getBondL1UnlockHeight: (bondIndex) =>
				getBondL1UnlockHeight(client, bondIndex),
			getSignerInfo: (signer) => getSignerInfo(client, signer),
			verifySignerKeyGrant: (signerManager, signerKey) =>
				verifySignerKeyGrantOnChain(client, signerManager, signerKey),
			getCurrentRewardCycle: () => getCurrentRewardCycle(client),
			getFirstRewardCycle: () => getFirstPox5RewardCycle(client),
			setupBond: (params) => setupBond(client, params),
			registerForBond: (params) => registerForBond(client, params),
			updateBondRegistration: (params) =>
				updateBondRegistration(client, params),
			stake: (params) => stake(client, params),
			stakeUpdate: (params) => stakeUpdate(client, params),
			unstake: (params) => unstake(client, params),
			unstakeSbtc: (params) => unstakeSbtc(client, params),
			announceL1EarlyExit: (params) => announceL1EarlyExit(client, params),
			calculateRewards: (params) => calculateRewards(client, params),
			claimRewards: (params) => claimRewards(client, params),
			claimStakerRewardsForSigner: (params) =>
				claimStakerRewardsForSigner(client, params),
			grantSignerKey: (params) => grantSignerKey(client, params),
			revokeSignerGrant: (params) => revokeSignerGrant(client, params),
		},
	});
}
