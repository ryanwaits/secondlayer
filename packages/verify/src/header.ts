// Stacks block header codecs + identity hashes: Nakamoto (stackslib
// chainstate/nakamoto/mod.rs NakamotoBlockHeader) and epoch 2.x
// (chainstate/stacks/block.rs StacksBlockHeader).
import { sha512_256 } from "@noble/hashes/sha2.js";
import { type Bytes, Reader, concat, hashAll } from "./bytes.ts";

export interface NakamotoHeader {
	/** Low 7 bits = header version; high bit = shadow block. */
	version: number;
	chainLength: bigint;
	burnSpent: bigint;
	consensusHash: Bytes;
	parentBlockId: Bytes;
	txMerkleRoot: Bytes;
	stateIndexRoot: Bytes;
	timestamp: bigint;
	minerSignature: Bytes;
	/** 65-byte recoverable signatures: recovery id, r, s. */
	signerSignatures: Bytes[];
	/** Header bytes minus the signer_signature vec: the signer sighash preimage. */
	signerSighashPreimage: Bytes;
	/** Serialized header length; block bytes after this are the transactions. */
	byteLength: number;
}

/** First header version whose sighash commits to `problematic_txs` (epoch 4.0). */
const NAKAMOTO_BLOCK_VERSION_EPOCH_4 = 1;
const MAX_SIGNERS = 4000;
const MAX_PROBLEMATIC_TXS = 1 << 16;

/**
 * Parse the NakamotoBlockHeader at the start of raw block bytes
 * (`/v3/blocks/<id>`). Handles v0 and v1 (v1 appends `problematic_txs`).
 */
export function parseNakamotoHeader(raw: Bytes): NakamotoHeader {
	const r = new Reader(raw);
	const version = r.u8();
	const chainLength = r.u64();
	const burnSpent = r.u64();
	const consensusHash = r.bytes(20);
	const parentBlockId = r.bytes(32);
	const txMerkleRoot = r.bytes(32);
	const stateIndexRoot = r.bytes(32);
	const timestamp = r.u64();
	const minerSignature = r.bytes(65);
	const sigStart = r.pos;
	const signerSignatures = r.vec(() => r.bytes(65), MAX_SIGNERS);
	const sigEnd = r.pos;
	// pox_treatment: BitVec<4000> = u16 bit length, then Vec<u8> of exactly ceil(len/8).
	const bits = r.u16();
	if (bits === 0 || bits > MAX_SIGNERS)
		throw new Error(`bad pox_treatment length ${bits}`);
	const bitBytes = Math.ceil(bits / 8);
	if (r.u32() !== bitBytes) throw new Error("bad pox_treatment data length");
	r.bytes(bitBytes);
	if ((version & 0x7f) >= NAKAMOTO_BLOCK_VERSION_EPOCH_4) {
		// problematic_txs: Vec<(u32 index, u8 marker)>
		r.vec(() => r.bytes(5), MAX_PROBLEMATIC_TXS);
	}
	const end = r.pos;
	return {
		version,
		chainLength,
		burnSpent,
		consensusHash,
		parentBlockId,
		txMerkleRoot,
		stateIndexRoot,
		timestamp,
		minerSignature,
		signerSignatures,
		signerSighashPreimage: concat([
			raw.subarray(0, sigStart),
			raw.subarray(sigEnd, end),
		]),
		byteLength: end,
	};
}

/**
 * NakamotoBlockHeader::signer_signature_hash: sha512/256 over every header field
 * except the signer signatures. Also the header's block_hash.
 */
export const signerSignatureHash = (h: NakamotoHeader): Bytes =>
	sha512_256(h.signerSighashPreimage);

/**
 * Epoch 2.x anchored block header. It commits to the parent's block hash, not
 * its index block hash, and carries no consensus hash: the source supplies
 * that, and `blockId` binds it to an id proven elsewhere.
 */
export interface Epoch2Header {
	version: number;
	/** total_work.burn: burn spent on the fork so far. */
	burnSpent: bigint;
	/** total_work.work: the Stacks chain length (one per anchored block). */
	chainLength: bigint;
	vrfProof: Bytes;
	parentBlockHash: Bytes;
	parentMicroblock: Bytes;
	parentMicroblockSequence: number;
	txMerkleRoot: Bytes;
	/** Covers the block and the parent microblock stream it confirms. */
	stateIndexRoot: Bytes;
	microblockPubkeyHash: Bytes;
	/** sha512/256 of the serialized header. */
	blockHash: Bytes;
	consensusHash: Bytes;
}

export type StacksHeader = NakamotoHeader | Epoch2Header;

/** StacksBlockHeader is fixed width: no signatures, no variable fields. */
export const EPOCH2_HEADER_LENGTH = 247;

/**
 * Parse the epoch 2.x StacksBlockHeader at the start of `raw` (a header from
 * `/v2/headers`, or block bytes from `/v2/blocks/<id>`), with the 20-byte
 * consensus hash of the sortition that elected it.
 */
export function parseEpoch2Header(
	raw: Bytes,
	consensusHash: Bytes,
): Epoch2Header {
	if (consensusHash.length !== 20)
		throw new Error(`consensus hash is ${consensusHash.length} bytes, not 20`);
	const r = new Reader(raw);
	const header: Omit<Epoch2Header, "blockHash" | "consensusHash"> = {
		version: r.u8(),
		burnSpent: r.u64(),
		chainLength: r.u64(),
		vrfProof: r.bytes(80),
		parentBlockHash: r.bytes(32),
		parentMicroblock: r.bytes(32),
		parentMicroblockSequence: r.u16(),
		txMerkleRoot: r.bytes(32),
		stateIndexRoot: r.bytes(32),
		microblockPubkeyHash: r.bytes(20),
	};
	return {
		...header,
		blockHash: sha512_256(raw.subarray(0, EPOCH2_HEADER_LENGTH)),
		consensusHash,
	};
}

export const isEpoch2Header = (h: StacksHeader): h is Epoch2Header =>
	"parentBlockHash" in h;

/**
 * StacksBlockId (index block hash) = sha512/256(block_hash || consensus_hash).
 * A Nakamoto block hash is its signer signature hash; a 2.x one hashes the
 * whole header.
 */
export const blockId = (h: StacksHeader): Bytes =>
	hashAll([
		isEpoch2Header(h) ? h.blockHash : signerSignatureHash(h),
		h.consensusHash,
	]);
