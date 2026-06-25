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
