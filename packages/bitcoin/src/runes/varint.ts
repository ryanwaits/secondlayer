/**
 * LEB128 varint over u128, ported from ord 0.29.0
 * `crates/ordinals/src/varint.rs`. bigint stands in for Rust's u128.
 */

export enum VarintError {
	Overlong = "too long",
	Overflow = "overflow",
	Unterminated = "unterminated",
}

export class VarintDecodeError extends Error {
	constructor(readonly kind: VarintError) {
		super(kind);
		this.name = "VarintDecodeError";
	}
}

const U128_MAX = (1n << 128n) - 1n;

export function encodeToVec(n: bigint, out: number[]): void {
	if (n < 0n || n > U128_MAX) {
		throw new RangeError("encodeToVec: value out of u128 range");
	}
	let value = n;
	while (value >> 7n > 0n) {
		out.push(Number((value & 0x7fn) | 0x80n));
		value >>= 7n;
	}
	out.push(Number(value & 0x7fn));
}

export function encode(n: bigint): Uint8Array {
	const out: number[] = [];
	encodeToVec(n, out);
	return Uint8Array.from(out);
}

/** Returns `[value, bytesConsumed]`. Throws `VarintDecodeError` on malformed input, matching ord's `Result<(u128, usize), Error>`. */
export function decode(buffer: Uint8Array): [bigint, number] {
	let n = 0n;

	for (let i = 0; i < buffer.length; i++) {
		if (i > 18) {
			throw new VarintDecodeError(VarintError.Overlong);
		}

		const byte = buffer[i] as number;
		const value = BigInt(byte) & 0x7fn;

		if (i === 18 && (value & 0b0111_1100n) !== 0n) {
			throw new VarintDecodeError(VarintError.Overflow);
		}

		n |= value << BigInt(7 * i);

		if ((byte & 0b1000_0000) === 0) {
			return [n, i + 1];
		}
	}

	throw new VarintDecodeError(VarintError.Unterminated);
}
