/**
 * Raw Bitcoin block parser. Reads the hex payload bitcoind returns for
 * `getblock <hash> 0` (raw serialized block, D6) and produces the minimal
 * structure the Runes decoder needs: block header linkage plus, per
 * transaction, txid, inputs (prevout + witness) and outputs (value + script).
 *
 * Serialization reference: Bitcoin Core's block/transaction wire format
 * (https://developer.bitcoin.org/reference/transactions.html). Not ord source
 * — ord itself uses the `bitcoin` crate for this, so there is no Rust file to
 * port here; the spec is the wire format itself.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export interface TxInput {
	/** Big-endian (display order) txid of the spent output, all-zero for coinbase. */
	prevTxid: string;
	prevVout: number;
	/** Witness stack items, empty for a non-segwit input. */
	witness: Uint8Array[];
}

export interface TxOutput {
	/** Satoshis. */
	value: bigint;
	/** Raw scriptPubKey bytes. */
	script: Uint8Array;
}

export interface ParsedTx {
	/** Big-endian (display order) txid — double-sha256 of the NON-witness serialization, byte-reversed. */
	txid: string;
	/** Internal (natural hash) byte order txid — double-sha256 of the NON-witness serialization, NOT reversed. Used for merkle-root verification (../integrity/merkle.ts). */
	txidBytes: Uint8Array;
	/** Internal (natural hash) byte order wtxid — double-sha256 of the FULL serialization (including segwit marker/flag/witness). Equals `txidBytes` for a non-segwit tx. Used for the BIP-141 witness commitment check. */
	wtxidBytes: Uint8Array;
	inputs: TxInput[];
	outputs: TxOutput[];
}

export interface ParsedBlock {
	/** Big-endian (display order) block hash. */
	hash: string;
	/** Big-endian (display order) previous block hash. */
	prevHash: string;
	/** Internal (natural hash) byte order merkle root, straight from the header (NOT reversed). Used for merkle-root verification (../integrity/merkle.ts). */
	merkleRootBytes: Uint8Array;
	/** Unix timestamp (block header `time` field, seconds). */
	time: number;
	txs: ParsedTx[];
}

class ByteReader {
	private pos = 0;
	constructor(private readonly buf: Uint8Array) {}

	get offset(): number {
		return this.pos;
	}

	get remaining(): number {
		return this.buf.length - this.pos;
	}

	rewindTo(pos: number): void {
		this.pos = pos;
	}

	/** Returns the bytes from `start` up to (not including) the current position. */
	sliceFrom(start: number): Uint8Array {
		return this.buf.subarray(start, this.pos);
	}

	u8(): number {
		const v = this.buf[this.pos];
		if (v === undefined) throw new RangeError("unexpected end of buffer");
		this.pos += 1;
		return v;
	}

	bytes(n: number): Uint8Array {
		if (this.pos + n > this.buf.length) {
			throw new RangeError("unexpected end of buffer");
		}
		const out = this.buf.subarray(this.pos, this.pos + n);
		this.pos += n;
		return out;
	}

	u32le(): number {
		const b = this.bytes(4);
		return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
	}

	u64le(): bigint {
		const b = this.bytes(8);
		return new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, true);
	}

	/** Bitcoin's CompactSize ("VarInt") encoding — distinct from the runestone LEB128 varint (runes/varint.ts). */
	compactSize(): number {
		const first = this.u8();
		if (first < 0xfd) return first;
		if (first === 0xfd) {
			const b = this.bytes(2);
			return new DataView(b.buffer, b.byteOffset, 2).getUint16(0, true);
		}
		if (first === 0xfe) return this.u32le();
		const v = this.u64le();
		if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new RangeError("compact size exceeds safe integer range");
		}
		return Number(v);
	}
}

function writeCompactSize(n: number): Uint8Array {
	if (n < 0xfd) return Uint8Array.of(n);
	if (n <= 0xffff) {
		const b = new Uint8Array(3);
		b[0] = 0xfd;
		new DataView(b.buffer).setUint16(1, n, true);
		return b;
	}
	if (n <= 0xffffffff) {
		const b = new Uint8Array(5);
		b[0] = 0xfe;
		new DataView(b.buffer).setUint32(1, n, true);
		return b;
	}
	const b = new Uint8Array(9);
	b[0] = 0xff;
	new DataView(b.buffer).setBigUint64(1, BigInt(n), true);
	return b;
}

function u32leBytes(n: number): Uint8Array {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, n, true);
	return b;
}

function u64leBytes(n: bigint): Uint8Array {
	const b = new Uint8Array(8);
	new DataView(b.buffer).setBigUint64(0, n, true);
	return b;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

/** Reverses byte order and hex-encodes — bitcoind displays hashes in this order. */
function displayHex(internalOrderBytes: Uint8Array): string {
	return bytesToHex(Uint8Array.from(internalOrderBytes).reverse());
}

function doubleSha256(data: Uint8Array): Uint8Array {
	return sha256(sha256(data));
}

interface RawInput {
	prevTxidInternal: Uint8Array;
	prevVout: number;
	scriptSig: Uint8Array;
	sequence: number;
	witness: Uint8Array[];
}

interface RawOutput {
	value: bigint;
	script: Uint8Array;
}

function parseTx(r: ByteReader): ParsedTx {
	const txStart = r.offset;
	const version = r.u32le();

	let segwit = false;
	const markerFlagPos = r.offset;
	// Peek for the segwit marker (0x00) + flag (0x01) that precede the input
	// count on a segwit transaction. A non-segwit tx starts its input count
	// here instead, which is never 0x00 (a tx with 0 inputs is invalid).
	if (r.remaining >= 2) {
		const marker = r.bytes(1)[0];
		const flag = r.bytes(1)[0];
		if (marker === 0x00 && flag === 0x01) {
			segwit = true;
		} else {
			// Not a marker/flag pair — rewind, this is the real input count.
			r.rewindTo(markerFlagPos);
		}
	}

	const inputCount = r.compactSize();
	const inputs: RawInput[] = [];
	for (let i = 0; i < inputCount; i++) {
		const prevTxidInternal = Uint8Array.from(r.bytes(32));
		const prevVout = r.u32le();
		const scriptSigLen = r.compactSize();
		const scriptSig = Uint8Array.from(r.bytes(scriptSigLen));
		const sequence = r.u32le();
		inputs.push({
			prevTxidInternal,
			prevVout,
			scriptSig,
			sequence,
			witness: [],
		});
	}

	const outputCount = r.compactSize();
	const outputs: RawOutput[] = [];
	for (let i = 0; i < outputCount; i++) {
		const value = r.u64le();
		const scriptLen = r.compactSize();
		const script = Uint8Array.from(r.bytes(scriptLen));
		outputs.push({ value, script });
	}

	if (segwit) {
		for (const input of inputs) {
			const itemCount = r.compactSize();
			const items: Uint8Array[] = [];
			for (let i = 0; i < itemCount; i++) {
				const len = r.compactSize();
				items.push(Uint8Array.from(r.bytes(len)));
			}
			input.witness = items;
		}
	}

	const locktime = r.u32le();

	// Non-witness ("legacy") serialization — used for the txid, per BIP-141.
	const parts: Uint8Array[] = [u32leBytes(version)];
	parts.push(writeCompactSize(inputs.length));
	for (const input of inputs) {
		parts.push(input.prevTxidInternal);
		parts.push(u32leBytes(input.prevVout));
		parts.push(writeCompactSize(input.scriptSig.length));
		parts.push(input.scriptSig);
		parts.push(u32leBytes(input.sequence));
	}
	parts.push(writeCompactSize(outputs.length));
	for (const output of outputs) {
		parts.push(u64leBytes(output.value));
		parts.push(writeCompactSize(output.script.length));
		parts.push(output.script);
	}
	parts.push(u32leBytes(locktime));

	const txidBytes = doubleSha256(concatBytes(parts));
	const txid = displayHex(txidBytes);

	// Full wire serialization (including the segwit marker/flag/witness, when
	// present) is exactly the bytes just read for this tx — no need to rebuild
	// it. For a non-segwit tx this span is byte-identical to the non-witness
	// serialization above, so wtxidBytes == txidBytes, as required.
	const wtxidBytes = segwit ? doubleSha256(r.sliceFrom(txStart)) : txidBytes;

	return {
		txid,
		txidBytes,
		wtxidBytes,
		inputs: inputs.map((input) => ({
			prevTxid: displayHex(input.prevTxidInternal),
			prevVout: input.prevVout,
			witness: input.witness,
		})),
		outputs: outputs.map((output) => ({
			value: output.value,
			script: output.script,
		})),
	};
}

export function parseBlock(hex: string): ParsedBlock {
	const buf = hexToBytes(hex);
	const r = new ByteReader(buf);

	// Header (80 bytes): version(4) + prevBlockHash(32) + merkleRoot(32) + time(4) + bits(4) + nonce(4).
	const headerStart = r.offset;
	r.bytes(4); // version
	const prevHashInternal = Uint8Array.from(r.bytes(32));
	const merkleRootBytes = Uint8Array.from(r.bytes(32));
	const time = r.u32le();
	r.bytes(4); // bits
	r.bytes(4); // nonce
	const header = buf.subarray(headerStart, r.offset);
	const hash = displayHex(doubleSha256(header));
	const prevHash = displayHex(prevHashInternal);

	const txCount = r.compactSize();
	const txs: ParsedTx[] = [];
	for (let i = 0; i < txCount; i++) {
		txs.push(parseTx(r));
	}

	return { hash, prevHash, merkleRootBytes, time, txs };
}
