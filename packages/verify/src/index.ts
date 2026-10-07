// Client-side verifier for a trustless Stacks index: check Clarity state
// against Nakamoto headers with zero trust in the serving node.
export { type Bytes, hex, unhex } from "./bytes.ts";
export {
	type NakamotoHeader,
	blockId,
	parseNakamotoHeader,
	signerSignatureHash,
} from "./header.ts";
export {
	type MarfProofInput,
	marfPath,
	marfValue,
	verifyMarfProof,
} from "./marf.ts";
export {
	type BlockDiff,
	type BlockDiffInput,
	type ClassifiedLeaf,
	type StateWitness,
	type WitnessLeaf,
	classifyBlockDiff,
	parseWitness,
} from "./witness.ts";
export {
	type SignerCheck,
	type SignerSet,
	decodeSignerSet,
	verifySignerSignatures,
} from "./signers.ts";
export {
	MAINNET_FIRST_BURN_HEIGHT,
	MAINNET_REWARD_CYCLE_LENGTH,
	rewardCycle,
	verifyConsensusPreimage,
} from "./burn.ts";
export { dataVarKey, ftBalanceKey, mapEntryKey } from "./keys.ts";
