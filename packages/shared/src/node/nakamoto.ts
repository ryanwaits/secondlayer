import { createHash } from "node:crypto";

/**
 * Nakamoto block-header parsing + consensus hashing for trustless verification.
 *
 * Version 0 is bit-exact against mainnet `stacks-node 3.4.0.0.3`. Version 1
 * (Epoch 4.0 / PoX-5, first mainnet height 8,665,568) appends
 * `problematic_txs` after `pox_treatment` and includes those bytes in the
 * signer-signature-hash preimage. Pre-4.0 hashes are unchanged.
 */

/** SHA-512/256 — the hash Stacks uses everywhere (NOT truncated SHA-512). */
export function sha512_256(bytes: Uint8Array): Uint8Array {
	return createHash("sha512-256").update(bytes).digest();
}

const toHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fromHex = (h: string): Uint8Array =>
	Uint8Array.from(Buffer.from(h.startsWith("0x") ? h.slice(2) : h, "hex"));

// Fixed-size header prefix: version..miner_signature, before signer_signature.
const PREFIX_LEN = 206;
const CONSENSUS_HASH_OFF = 17;
const TX_MERKLE_ROOT_OFF = 69;
const STATE_INDEX_ROOT_OFF = 101;
const TIMESTAMP_OFF = 133;
const MINER_SIG_OFF = 141;
const SIGNER_VEC_OFF = 206; // u32 count, then 65 bytes per signer
const SIG_LEN = 65;
const PROBLEMATIC_TX_MARKER_LEN = 5; // u32 tx_index ‖ u8 category

/** Pre-Epoch-4.0 Nakamoto header. Omits `problematic_txs`. */
export const NAKAMOTO_BLOCK_VERSION = 0;
/** Epoch 4.0+ header. Serializes and hashes `problematic_txs`. */
export const NAKAMOTO_BLOCK_VERSION_EPOCH_4 = 1;

export type ProblematicTxMarker = {
	txIndex: number;
	category: number;
};

/** Low 7 bits are the header version; high bit 0x80 is the shadow-block flag. */
export function versionIncludesProblematicTxs(version: number): boolean {
	return (version & 0x7f) >= NAKAMOTO_BLOCK_VERSION_EPOCH_4;
}

export interface NakamotoBlockHeader {
	version: number;
	chainLength: bigint;
	burnSpent: bigint;
	/** 20-byte consensus hash (hex). */
	consensusHash: string;
	/** 32-byte parent StacksBlockId (hex). */
	parentBlockId: string;
	/** 32-byte SHA512/256 merkle root over the block's txids (hex). */
	txMerkleRoot: string;
	/** 32-byte MARF root after applying this block (hex). */
	stateIndexRoot: string;
	timestamp: bigint;
	/** 65-byte recoverable ECDSA miner signature (hex). */
	minerSignature: string;
	/** Per-signer recoverable ECDSA signatures, reward-set order (hex, 65B each). */
	signerSignatures: string[];
	/** Full serialized pox_treatment BitVec bytes (u16 bits ‖ u32 len ‖ data). */
	poxTreatment: Uint8Array;
	/**
	 * Epoch 4.0+ marker list. Empty (and absent from the wire) on version 0.
	 * An empty list still serializes as a u32 count of 0 on version 1+.
	 */
	problematicTxs: ProblematicTxMarker[];
	/**
	 * Exact bytes whose SHA512/256 IS the block_hash / signer_signature_hash:
	 * header minus the signer_signature vector. Version 0 is
	 * prefix[0:206] ‖ pox; version 1+ is prefix[0:206] ‖ pox ‖ problematic_txs.
	 */
	signerSignatureHashPreimage: Uint8Array;
	/** Offset at which the tx `Vec` begins (= total header byte length). */
	headerByteLength: number;
}

function u32(b: Uint8Array, off: number): number {
	return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(off);
}
function u64(b: Uint8Array, off: number): bigint {
	return new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(off);
}

/** Parse the Nakamoto block header from the raw `/v3/blocks` body. */
export function parseNakamotoBlockHeader(raw: Uint8Array): NakamotoBlockHeader {
	if (raw.length < PREFIX_LEN + 4) {
		throw new Error("raw block too short for a Nakamoto header");
	}
	const version = raw[0];
	const signerCount = u32(raw, SIGNER_VEC_OFF);
	const sigsStart = SIGNER_VEC_OFF + 4;
	if (sigsStart + signerCount * SIG_LEN > raw.length) {
		throw new Error("raw block truncated in signer_signature vector");
	}
	const signerSignatures: string[] = [];
	for (let i = 0; i < signerCount; i++) {
		const off = sigsStart + i * SIG_LEN;
		signerSignatures.push(toHex(raw.subarray(off, off + SIG_LEN)));
	}
	// pox_treatment: u16 num_bits ‖ u32 data_len ‖ data[data_len].
	const poxOff = sigsStart + signerCount * SIG_LEN;
	if (poxOff + 6 > raw.length) {
		throw new Error("raw block truncated in pox_treatment");
	}
	const poxDataLen = u32(raw, poxOff + 2);
	const poxEnd = poxOff + 6 + poxDataLen;
	if (poxEnd > raw.length) {
		throw new Error("raw block truncated in pox_treatment data");
	}
	const poxTreatment = raw.subarray(poxOff, poxEnd);

	// Epoch 4.0+ (version low-7-bits >= 1): Vec<ProblematicTxMarker>
	// after pox_treatment. Version 0 omits the field entirely so pre-fork
	// hashes stay byte-identical.
	let headerEnd = poxEnd;
	const problematicTxs: ProblematicTxMarker[] = [];
	if (versionIncludesProblematicTxs(version)) {
		if (poxEnd + 4 > raw.length) {
			throw new Error("raw block truncated in problematic_txs count");
		}
		const markerCount = u32(raw, poxEnd);
		headerEnd = poxEnd + 4 + markerCount * PROBLEMATIC_TX_MARKER_LEN;
		if (headerEnd > raw.length) {
			throw new Error("raw block truncated in problematic_txs list");
		}
		for (let i = 0; i < markerCount; i++) {
			const off = poxEnd + 4 + i * PROBLEMATIC_TX_MARKER_LEN;
			problematicTxs.push({
				txIndex: u32(raw, off),
				category: raw[off + 4] ?? 0,
			});
		}
	}

	// block_hash preimage = header minus signer_signature.
	// v0: prefix[0:206] ‖ pox
	// v1: prefix[0:206] ‖ pox ‖ problematic_txs (count + markers)
	const markersBytes = raw.subarray(poxEnd, headerEnd);
	const preimage = new Uint8Array(
		PREFIX_LEN + poxTreatment.length + markersBytes.length,
	);
	preimage.set(raw.subarray(0, PREFIX_LEN), 0);
	preimage.set(poxTreatment, PREFIX_LEN);
	preimage.set(markersBytes, PREFIX_LEN + poxTreatment.length);

	return {
		version,
		chainLength: u64(raw, 1),
		burnSpent: u64(raw, 9),
		consensusHash: toHex(
			raw.subarray(CONSENSUS_HASH_OFF, CONSENSUS_HASH_OFF + 20),
		),
		parentBlockId: toHex(raw.subarray(37, 69)),
		txMerkleRoot: toHex(
			raw.subarray(TX_MERKLE_ROOT_OFF, TX_MERKLE_ROOT_OFF + 32),
		),
		stateIndexRoot: toHex(
			raw.subarray(STATE_INDEX_ROOT_OFF, STATE_INDEX_ROOT_OFF + 32),
		),
		timestamp: u64(raw, TIMESTAMP_OFF),
		minerSignature: toHex(raw.subarray(MINER_SIG_OFF, MINER_SIG_OFF + SIG_LEN)),
		signerSignatures,
		poxTreatment,
		problematicTxs,
		signerSignatureHashPreimage: preimage,
		headerByteLength: headerEnd,
	};
}

/**
 * block_hash (== signer_signature_hash): SHA512/256 over the header with the
 * signer_signature vector omitted. This is what each signer signs.
 */
export function nakamotoBlockHash(header: NakamotoBlockHeader): string {
	return toHex(sha512_256(header.signerSignatureHashPreimage));
}

/** index_block_hash (StacksBlockId) = SHA512/256(block_hash ‖ consensus_hash). */
export function nakamotoBlockId(
	blockHashHex: string,
	consensusHashHex: string,
): string {
	const a = fromHex(blockHashHex);
	const b = fromHex(consensusHashHex);
	const buf = new Uint8Array(a.length + b.length);
	buf.set(a, 0);
	buf.set(b, a.length);
	return toHex(sha512_256(buf));
}

/** A Stacks txid = SHA512/256 of the transaction's consensus serialization. */
export function stacksTxid(rawTx: Uint8Array): string {
	return toHex(sha512_256(rawTx));
}

const LEAF_TAG = 0x00;
const NODE_TAG = 0x01;

function tagged(tag: number, ...parts: Uint8Array[]): Uint8Array {
	const len = parts.reduce((n, p) => n + p.length, 1);
	const buf = new Uint8Array(len);
	buf[0] = tag;
	let o = 1;
	for (const p of parts) {
		buf.set(p, o);
		o += p.length;
	}
	return sha512_256(buf);
}

/**
 * tx_merkle_root over the block's txids (hex), reproducing the consensus rule:
 * leaf = H(0x00 ‖ txid), node = H(0x01 ‖ left ‖ right), odd level duplicates the
 * last node. Returns the root hex; throws on an empty tx list.
 */
export function txMerkleRoot(txidsHex: string[]): string {
	if (txidsHex.length === 0) throw new Error("no transactions");
	let level = txidsHex.map((t) => tagged(LEAF_TAG, fromHex(t)));
	while (level.length > 1) {
		if (level.length % 2 === 1) level.push(level[level.length - 1]);
		const next: Uint8Array[] = [];
		for (let i = 0; i < level.length; i += 2) {
			next.push(tagged(NODE_TAG, level[i], level[i + 1]));
		}
		level = next;
	}
	return toHex(level[0]);
}

/** One authentication-path step: the sibling hash and which side it's on. */
export interface MerkleProofStep {
	/** Side the SIBLING is on relative to the accumulator. */
	position: "left" | "right";
	/** Sibling node hash (hex). */
	hash: string;
}

/**
 * Build the tx-inclusion authentication path for the tx at `index` in a block,
 * reproducing the consensus merkle tree (incl. duplicate-last-on-odd). The path
 * lets a verifier recompute `tx_merkle_root` from just the target txid.
 */
export function txMerkleProof(
	txidsHex: string[],
	index: number,
): MerkleProofStep[] {
	if (index < 0 || index >= txidsHex.length) {
		throw new Error("index out of range");
	}
	let level = txidsHex.map((t) => tagged(LEAF_TAG, fromHex(t)));
	let idx = index;
	const path: MerkleProofStep[] = [];
	while (level.length > 1) {
		if (level.length % 2 === 1) level.push(level[level.length - 1]);
		const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
		path.push({
			position: idx % 2 === 0 ? "right" : "left",
			hash: toHex(level[siblingIdx]),
		});
		const next: Uint8Array[] = [];
		for (let i = 0; i < level.length; i += 2) {
			next.push(tagged(NODE_TAG, level[i], level[i + 1]));
		}
		level = next;
		idx = Math.floor(idx / 2);
	}
	return path;
}

/**
 * Verify a tx-inclusion proof: fold the target `txid` (hex) up through `path`
 * and check it equals `txMerkleRoot` (hex). The verifier recomputes the txid
 * itself from the raw tx bytes, so nothing here is trusted.
 */
export function verifyTxMerkleProof(
	txidHex: string,
	path: MerkleProofStep[],
	txMerkleRootHex: string,
): boolean {
	let acc = tagged(LEAF_TAG, fromHex(txidHex));
	for (const step of path) {
		const sib = fromHex(step.hash);
		acc =
			step.position === "right"
				? tagged(NODE_TAG, acc, sib)
				: tagged(NODE_TAG, sib, acc);
	}
	const root = txMerkleRootHex.startsWith("0x")
		? txMerkleRootHex.slice(2)
		: txMerkleRootHex;
	return toHex(acc) === root;
}

/**
 * Fetch and parse a Nakamoto block from a stacks-node. `blockId` is the
 * index_block_hash (with or without 0x). Returns the raw bytes + parsed header +
 * the recomputed block_hash / index_block_hash so a caller can cross-check.
 */
export async function fetchNakamotoBlock(opts: {
	nodeUrl: string;
	blockId: string;
	fetchImpl?: typeof fetch;
}): Promise<{
	raw: Uint8Array;
	header: NakamotoBlockHeader;
	blockHash: string;
	indexBlockHash: string;
}> {
	const id = opts.blockId.startsWith("0x")
		? opts.blockId.slice(2)
		: opts.blockId;
	const f = opts.fetchImpl ?? fetch;
	const res = await f(`${opts.nodeUrl.replace(/\/+$/, "")}/v3/blocks/${id}`);
	if (!res.ok) {
		throw new Error(`/v3/blocks/${id} returned ${res.status}`);
	}
	const raw = new Uint8Array(await res.arrayBuffer());
	const header = parseNakamotoBlockHeader(raw);
	const blockHash = nakamotoBlockHash(header);
	return {
		raw,
		header,
		blockHash,
		indexBlockHash: nakamotoBlockId(blockHash, header.consensusHash),
	};
}
