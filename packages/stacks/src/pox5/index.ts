/**
 * PoX-5 (SIP-045 Bitcoin Staking) — foundation surface, pinned against the
 * final contract in stacks-core 4.0.0 (activation: Bitcoin block 960,230,
 * ~2026-07-29). Contract-call actions and read helpers land as the second
 * phase; everything here is chain-parameter math, script construction, and
 * grant signing that works before activation.
 */

export {
	assertPox5Active,
	getPox5Activation,
	isPox5Active,
	type Pox5Activation,
} from "./activation.ts";
export {
	BITCOIN_LOCKTIME_THRESHOLD,
	BOND_GAP_CYCLES,
	BOND_LENGTH_CYCLES,
	C_SCRIPT_NUM_MAX,
	MAX_NUM_CYCLES,
	POX5_ACTIVATION_BURN_HEIGHT_MAINNET,
	POX5_CONTRACT_NAME,
	POX5_SIGNER_DOMAIN,
} from "./constants.ts";
export {
	type BondCycleParams,
	type BondPhase,
	bondPeriodToBurnHeight,
	bondPeriodToRewardCycle,
	bondPhaseAtHeight,
	bondUnlockCycle,
	burnHeightToDistributionIndex,
	burnHeightToRewardCycle,
	isInPreparePhase,
	type PoxCycleParams,
	rewardCycleToBurnHeight,
} from "./cycles.ts";
export {
	type BuildLockupScriptOptions,
	buildDefaultStakerUnlockBytes,
	buildLockupAddress,
	buildLockupOutputScript,
	buildLockupScript,
	pushCScriptNum,
	pushScriptBytes,
	serializeCScriptNum,
	stakerConsensusBuff,
	stakerPreimage,
} from "./script.ts";
export {
	computeSignerGrantHash,
	type SignerGrantOptions,
	signSignerGrant,
	verifySignerGrant,
} from "./grants.ts";
