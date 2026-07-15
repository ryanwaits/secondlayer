export {
	type BitcoinTxInput,
	type BitcoinTxOutput,
	type BlockHeader,
	BtcReader,
	bitcoinTxid,
	blockHash,
	doubleSha256,
	type ParsedBitcoinTx,
	parseBitcoinTx,
	parseBlockHeader,
	reverseBytes,
	stripWitness,
} from "./serialize.ts";

export {
	type BitcoinRpcConfig,
	type BlockForTx,
	bitcoinRpcSource,
	buildTxProof,
	type EsploraConfig,
	esploraSource,
	fallbackProofSource,
	type ProofSource,
	type SpvProof,
} from "./proof.ts";

export {
	buildMerkleProof,
	type MerkleProof,
	merkleRoot,
	rootFromProof,
} from "./merkle.ts";

export {
	type DecodedTxOutput,
	decodeTxOutput,
	encodeMerkleProofArgs,
	type OutputScriptType,
	type ParsedOutputScript,
	parseOutputScript,
} from "./codec.ts";

export {
	type BitcoinNetwork,
	SPV_ADAPTER_CONTRACTS,
	type SpvAdapterRef,
	getSpvAdapter,
	spvAdapterPrincipal,
} from "./constants.ts";
export { SPV_ADAPTER_ABI } from "./abi/spvAdapter.ts";
export {
	type Clarity6Gate,
	getBurnBlockHeight,
	isClarity6Active,
} from "./activation.ts";
export {
	type BitcoinVerifier,
	type BitcoinVerifierConfig,
	bitcoinVerifier,
} from "./verifier.ts";
export {
	formatBitcoinAddress,
	publicKeyToP2trAddress,
	publicKeyToP2wpkhAddress,
	taprootTweakPubkey,
} from "./address.ts";
export {
	type BitcoinPaymentOutput,
	type VerifyBitcoinPaymentParams,
	type VerifyBitcoinPaymentResult,
	verifyBitcoinPayment,
} from "./actions.ts";
