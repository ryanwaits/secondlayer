// Byte helpers shared by every codec here. Browser-safe: no Buffer.
import { sha512_256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";

export type Bytes = Uint8Array;

export const hex = (b: Bytes): string => bytesToHex(b);

/** Hex to bytes; tolerates a 0x prefix. */
export const unhex = (s: string): Bytes =>
	hexToBytes(s.startsWith("0x") ? s.slice(2) : s);

export const concat = (parts: Bytes[]): Bytes => concatBytes(...parts);

export const bytesEqual = (a: Bytes, b: Bytes): boolean => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
};

/** sha512/256 over the concatenation of `parts` (stacks-core TrieHasher). */
export const hashAll = (parts: Bytes[]): Bytes => {
	const h = sha512_256.create();
	for (const p of parts) h.update(p);
	return h.digest();
};

/** Big-endian cursor over consensus-serialized bytes. Throws on overrun. */
export class Reader {
	pos = 0;
	constructor(readonly buf: Bytes) {}

	bytes(n: number): Bytes {
		if (n < 0 || this.pos + n > this.buf.length)
			throw new Error(`unexpected end of input at ${this.pos} reading ${n}`);
		const out = this.buf.subarray(this.pos, this.pos + n);
		this.pos += n;
		return out;
	}

	private view(n: number): DataView {
		const b = this.bytes(n);
		return new DataView(b.buffer, b.byteOffset, n);
	}

	u8 = (): number => this.bytes(1)[0] as number;
	u16 = (): number => this.view(2).getUint16(0);
	u32 = (): number => this.view(4).getUint32(0);
	u64 = (): bigint => this.view(8).getBigUint64(0);
	i64 = (): bigint => this.view(8).getBigInt64(0);

	/** StacksMessageCodec Vec<T>: u32 count prefix, then items. */
	vec<T>(item: () => T, max: number): T[] {
		const n = this.u32();
		if (n > max) throw new Error(`vec length ${n} exceeds ${max}`);
		return Array.from({ length: n }, item);
	}

	get done(): boolean {
		return this.pos === this.buf.length;
	}
}
