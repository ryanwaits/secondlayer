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
	marfProofAncestors,
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
	SIGNERS_CONTRACT,
	type SignerCheck,
	type SignerSet,
	decodeSignerSet,
	verifySignerSignatures,
} from "./signers.ts";
export {
	MAINNET_FIRST_BURN_HEIGHT,
	MAINNET_PREPARE_LENGTH,
	MAINNET_REWARD_CYCLE_LENGTH,
	cycleStart,
	rewardCycle,
	verifyConsensusPreimage,
} from "./burn.ts";
export { dataVarKey, ftBalanceKey, mapEntryKey } from "./keys.ts";
export {
	type Checkpoint,
	HeaderChain,
	type HeaderRule,
	HeaderValidationError,
} from "./bitcoin/chain.ts";
export { MAINNET_CHECKPOINT, type VerifyCheckpoint } from "./checkpoint.ts";
export {
	type BurnPreimage,
	type MarfProofResponse,
	NodeRpcProofSource,
	type NodeRpcSourceOptions,
	type ProofSource,
	SecondlayerProofSource,
	type SecondlayerSourceOptions,
	SourceError,
	type StateWrite,
	type VmEventRow,
} from "./source.ts";
export {
	type BlockStateInput,
	type BlockStateResult,
	type DiffLeaf,
	type DiffWrite,
	type ProvenDiff,
	type StateFailure,
	type StateFailureCode,
	verifyBlockState,
} from "./state.ts";
export {
	type BlockVerification,
	BlockVerifier,
	type VerifyFailure,
	type VerifyFailureCode,
	type VerifyOptions,
	type VerifyStep,
	verifyBlock,
} from "./verify-block.ts";
