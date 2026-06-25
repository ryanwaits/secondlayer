export {
	type BitcoinTxInput,
	type BitcoinTxOutput,
	BtcReader,
	bitcoinTxid,
	doubleSha256,
	type ParsedBitcoinTx,
	parseBitcoinTx,
	reverseBytes,
	stripWitness,
} from "./serialize.ts";

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
