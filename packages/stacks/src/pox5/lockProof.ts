import { sha256 } from "@noble/hashes/sha2.js";
import {
	type ProofSource,
	type SpvProof,
	buildTxProof,
} from "../bitcoin/proof.ts";
import { parseBitcoinTx, stripWitness } from "../bitcoin/serialize.ts";
import {
	type IntegerType,
	bytesToHex,
	concatBytes,
} from "../utils/encoding.ts";
import type { L1LockupOutput } from "./actions.ts";

/** pox-5 ABI: `(list 14 (buff 32))`. SIP-044 allows 24; we throw rather than truncate. */
const MAX_LEAF_HASHES = 14;

/** P2WSH scriptPubKey: `0x0020 || sha256(witness script)`. */
function lockupScriptPubKey(lockScript: Uint8Array): Uint8Array {
	return concatBytes(Uint8Array.of(0x00, 0x20), sha256(lockScript));
}

function scriptsEqual(a: Uint8Array, b: Uint8Array): boolean {
	return bytesToHex(a) === bytesToHex(b);
}

/**
 * Map a generic SIP-044 `SpvProof` onto pox-5's `L1LockupOutput`.
 * Witness is stripped, the lockup vout is resolved against the P2WSH
 * of `lockScript`, and more than {@link MAX_LEAF_HASHES} siblings throws.
 */
export function spvProofToL1LockupOutput(opts: {
	proof: SpvProof;
	/** Witness script; hashed to match the P2WSH lockup output. */
	lockScript: Uint8Array;
	unlockBurnHeight: IntegerType;
	/** Default: `proof.vout`, else the unique matching output. */
	vout?: number;
}): L1LockupOutput {
	const { proof, lockScript, unlockBurnHeight } = opts;
	const tx = stripWitness(proof.rawTx);
	const parsed = parseBitcoinTx(proof.rawTx);
	const expected = lockupScriptPubKey(lockScript);

	let outputIndex = opts.vout ?? proof.vout;
	if (outputIndex === undefined) {
		const matches: number[] = [];
		for (let i = 0; i < parsed.outputs.length; i++) {
			const spk = parsed.outputs[i]?.scriptPubKey;
			if (spk && scriptsEqual(spk, expected)) matches.push(i);
		}
		if (matches.length !== 1) {
			throw new Error(
				`spvProofToL1LockupOutput: expected exactly one matching lockup output, found ${matches.length}`,
			);
		}
		outputIndex = matches[0] as number;
	}

	const output = parsed.outputs[outputIndex];
	if (!output) {
		throw new Error(
			`spvProofToL1LockupOutput: output ${outputIndex} is out of range (${parsed.outputs.length} outputs)`,
		);
	}
	if (!scriptsEqual(output.scriptPubKey, expected)) {
		throw new Error("lockup output script does not match");
	}

	const leafHashes = proof.merkle.siblings;
	if (leafHashes.length > MAX_LEAF_HASHES) {
		throw new Error(
			`spvProofToL1LockupOutput: ${leafHashes.length} merkle siblings; pox-5 accepts at most ${MAX_LEAF_HASHES}`,
		);
	}

	return {
		height: proof.height,
		tx,
		outputIndex,
		header: proof.header,
		leafHashes,
		txCount: proof.merkle.txCount,
		txIndex: proof.merkle.txIndex,
		amount: output.value,
		unlockBurnHeight,
	};
}

/**
 * Fetch a SIP-044 proof from `source` and map it onto pox-5's lockup shape.
 * `source` is required — no hosted Esplora default.
 */
export async function buildPox5LockProof(opts: {
	source: ProofSource;
	txid: string;
	lockScript: Uint8Array;
	unlockBurnHeight: IntegerType;
	vout?: number;
}): Promise<L1LockupOutput> {
	const proof = await buildTxProof(opts.source, {
		txid: opts.txid,
		vout: opts.vout,
	});
	return spvProofToL1LockupOutput({
		proof,
		lockScript: opts.lockScript,
		unlockBurnHeight: opts.unlockBurnHeight,
		vout: opts.vout,
	});
}
