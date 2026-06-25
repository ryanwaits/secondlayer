import { concatBytes } from "../utils/encoding.ts";
import { sha256 } from "../utils/hash.ts";

/**
 * Bitcoin double-SHA256: `sha256(sha256(bytes))`. This is the hash Bitcoin uses
 * for txids, block headers, and merkle nodes — NOT the same as the Stacks
 * `txidFromBytes` (which uses sha512_256), so it lives here, not in `utils/hash`.
 */
export function doubleSha256(bytes: Uint8Array): Uint8Array {
	return sha256(sha256(bytes));
}

/**
 * Reverse a byte array. Bitcoin hashes are computed and stored in *internal*
 * (little-endian) order but *displayed* big-endian, so the two differ by a
 * reversal. The SIP-044 built-ins consume internal order; only reverse for
 * display / when matching an explorer value.
 */
export function reverseBytes(bytes: Uint8Array): Uint8Array {
	const out = new Uint8Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) {
		out[i] = bytes[bytes.length - 1 - i] as number;
	}
	return out;
}

/**
 * A little-endian, varint-aware byte reader for Bitcoin serialization. The
 * shared `utils/BytesReader` is big-endian only; Bitcoin tx fields are
 * little-endian with compact-size (varint) length prefixes.
 */
export class BtcReader {
	private readonly data: Uint8Array;
	private readonly view: DataView;
	public offset = 0;

	constructor(data: Uint8Array) {
		this.data = data;
		this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	}

	get length(): number {
		return this.data.length;
	}

	readUInt8(): number {
		const v = this.view.getUint8(this.offset);
		this.offset += 1;
		return v;
	}

	/** Read the next byte without advancing. */
	peekUInt8(): number {
		return this.view.getUint8(this.offset);
	}

	readUInt32LE(): number {
		const v = this.view.getUint32(this.offset, true);
		this.offset += 4;
		return v;
	}

	readUInt64LE(): bigint {
		const v = this.view.getBigUint64(this.offset, true);
		this.offset += 8;
		return v;
	}

	readBytes(n: number): Uint8Array {
		if (this.offset + n > this.data.length) {
			throw new Error(
				`Bitcoin tx underflow: need ${n} bytes at offset ${this.offset}, have ${this.data.length}`,
			);
		}
		const slice = this.data.slice(this.offset, this.offset + n);
		this.offset += n;
		return slice;
	}

	/** Read a Bitcoin compact-size unsigned integer (varint). */
	readVarInt(): number {
		const first = this.readUInt8();
		if (first < 0xfd) return first;
		if (first === 0xfd) {
			const v = this.view.getUint16(this.offset, true);
			this.offset += 2;
			return v;
		}
		if (first === 0xfe) {
			return this.readUInt32LE();
		}
		const big = this.readUInt64LE();
		if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new Error("Bitcoin varint exceeds safe integer range");
		}
		return Number(big);
	}
}

export interface BitcoinTxInput {
	/** Previous output txid, in serialized (internal) byte order. */
	prevTxid: Uint8Array;
	vout: number;
	scriptSig: Uint8Array;
	sequence: number;
}

export interface BitcoinTxOutput {
	/** Output value in satoshis. */
	value: bigint;
	scriptPubKey: Uint8Array;
}

export interface ParsedBitcoinTx {
	version: number;
	hasWitness: boolean;
	inputs: BitcoinTxInput[];
	outputs: BitcoinTxOutput[];
	locktime: number;
	/**
	 * The legacy txid as the raw double-SHA256 in *internal* byte order — ready
	 * to pass as the leaf to `verify-merkle-proof`. Witness data is excluded
	 * (the txid is computed over the legacy serialization), so this is stable for
	 * both legacy and SegWit txs. Use `reverseBytes` for the displayed form.
	 */
	txidInternal: Uint8Array;
}

interface ScanResult {
	version: number;
	hasWitness: boolean;
	inputs: BitcoinTxInput[];
	outputs: BitcoinTxOutput[];
	locktime: number;
	/** The legacy (witness-stripped) serialization — what the txid is hashed over. */
	legacy: Uint8Array;
}

/**
 * Single-pass scan of a raw Bitcoin tx. Captures the inputs/outputs slice and
 * reassembles the legacy serialization so both `parseBitcoinTx` and
 * `stripWitness` share one parser (and one set of foot-guns).
 */
function scanTx(rawTx: Uint8Array): ScanResult {
	const r = new BtcReader(rawTx);
	const version = r.readUInt32LE();

	// SegWit marker (0x00) + flag (0x01) sit immediately after the version. A
	// legacy tx can never have a zero input count, so 0x00 here is unambiguous.
	let hasWitness = false;
	if (r.peekUInt8() === 0x00) {
		r.readUInt8(); // marker
		const flag = r.readUInt8();
		if (flag !== 0x01) {
			throw new Error(`Unexpected SegWit flag 0x${flag.toString(16)}`);
		}
		hasWitness = true;
	}

	const bodyStart = r.offset;
	const inputCount = r.readVarInt();
	const inputs: BitcoinTxInput[] = [];
	for (let i = 0; i < inputCount; i++) {
		const prevTxid = r.readBytes(32);
		const vout = r.readUInt32LE();
		const scriptSig = r.readBytes(r.readVarInt());
		const sequence = r.readUInt32LE();
		inputs.push({ prevTxid, vout, scriptSig, sequence });
	}

	const outputCount = r.readVarInt();
	const outputs: BitcoinTxOutput[] = [];
	for (let i = 0; i < outputCount; i++) {
		const value = r.readUInt64LE();
		const scriptPubKey = r.readBytes(r.readVarInt());
		outputs.push({ value, scriptPubKey });
	}
	const bodyEnd = r.offset;

	if (hasWitness) {
		for (let i = 0; i < inputCount; i++) {
			const itemCount = r.readVarInt();
			for (let j = 0; j < itemCount; j++) {
				r.readBytes(r.readVarInt());
			}
		}
	}

	const locktime = r.readUInt32LE();

	const legacy = concatBytes(
		rawTx.slice(0, 4),
		rawTx.slice(bodyStart, bodyEnd),
		rawTx.slice(r.offset - 4, r.offset),
	);

	return { version, hasWitness, inputs, outputs, locktime, legacy };
}

/** Parse a serialized Bitcoin tx (legacy or SegWit) into its fields + txid. */
export function parseBitcoinTx(rawTx: Uint8Array): ParsedBitcoinTx {
	const s = scanTx(rawTx);
	return {
		version: s.version,
		hasWitness: s.hasWitness,
		inputs: s.inputs,
		outputs: s.outputs,
		locktime: s.locktime,
		txidInternal: doubleSha256(s.legacy),
	};
}

/**
 * Return the legacy (witness-stripped) serialization of a tx. For a legacy tx
 * this is the input unchanged; for a SegWit tx the marker, flag, and witness
 * stack are removed. This is the byte string the txid is hashed over.
 */
export function stripWitness(rawTx: Uint8Array): Uint8Array {
	return scanTx(rawTx).legacy;
}

/**
 * Compute a tx's id from its raw serialization. Internal byte order by default
 * (the merkle leaf / built-in input); pass `{ display: true }` for the
 * explorer-style big-endian form.
 */
export function bitcoinTxid(
	rawTx: Uint8Array,
	{ display = false }: { display?: boolean } = {},
): Uint8Array {
	const txid = doubleSha256(scanTx(rawTx).legacy);
	return display ? reverseBytes(txid) : txid;
}

export interface BlockHeader {
	version: number;
	/** Previous block hash, internal byte order. */
	prevBlock: Uint8Array;
	/** Merkle root, internal byte order — pairs with `verify-merkle-proof`. */
	merkleRoot: Uint8Array;
	timestamp: number;
	bits: number;
	nonce: number;
}

/** Parse an 80-byte Bitcoin block header into its fields (hashes internal order). */
export function parseBlockHeader(header: Uint8Array): BlockHeader {
	if (header.length !== 80) {
		throw new Error(
			`Bitcoin block header must be 80 bytes, got ${header.length}`,
		);
	}
	const r = new BtcReader(header);
	const version = r.readUInt32LE();
	const prevBlock = r.readBytes(32);
	const merkleRoot = r.readBytes(32);
	const timestamp = r.readUInt32LE();
	const bits = r.readUInt32LE();
	const nonce = r.readUInt32LE();
	return { version, prevBlock, merkleRoot, timestamp, bits, nonce };
}

/**
 * Hash an 80-byte block header (double-SHA256). Internal byte order by default;
 * `{ display: true }` for the explorer-style block hash.
 */
export function blockHash(
	header: Uint8Array,
	{ display = false }: { display?: boolean } = {},
): Uint8Array {
	const hash = doubleSha256(header);
	return display ? reverseBytes(hash) : hash;
}
