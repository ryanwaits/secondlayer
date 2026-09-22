// Ported test-for-test from ord 0.29.0 `crates/ordinals/src/varint.rs` `#[cfg(test)] mod tests`.
import { describe, expect, test } from "bun:test";
import { VarintDecodeError, VarintError, decode, encode } from "./varint.ts";

describe("varint", () => {
	test("zero round trips successfully", () => {
		const n = 0n;
		const encoded = encode(n);
		const [decoded, length] = decode(encoded);
		expect(decoded).toBe(n);
		expect(length).toBe(encoded.length);
	});

	test("u128 max round trips successfully", () => {
		const n = (1n << 128n) - 1n;
		const encoded = encode(n);
		const [decoded, length] = decode(encoded);
		expect(decoded).toBe(n);
		expect(length).toBe(encoded.length);
	});

	test("powers of two round trip successfully", () => {
		for (let i = 0n; i < 128n; i++) {
			const n = 1n << i;
			const encoded = encode(n);
			const [decoded, length] = decode(encoded);
			expect(decoded).toBe(n);
			expect(length).toBe(encoded.length);
		}
	});

	test("alternating bit strings round trip successfully", () => {
		let n = 0n;
		for (let i = 0n; i < 129n; i++) {
			n = (n << 1n) | (i % 2n);
			const encoded = encode(n);
			const [decoded, length] = decode(encoded);
			expect(decoded).toBe(n);
			expect(length).toBe(encoded.length);
		}
	});

	test("varints may not be longer than 19 bytes", () => {
		const VALID = Uint8Array.from([
			128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
			128, 128, 128, 0,
		]);
		const INVALID = Uint8Array.from([
			128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
			128, 128, 128, 128, 0,
		]);

		expect(decode(VALID)).toEqual([0n, 19]);
		expect(() => decode(INVALID)).toThrow(VarintDecodeError);
		try {
			decode(INVALID);
			throw new Error("expected decode to throw");
		} catch (e) {
			expect(e).toBeInstanceOf(VarintDecodeError);
			expect((e as VarintDecodeError).kind).toBe(VarintError.Overlong);
		}
	});

	test("varints may not overflow u128", () => {
		const overflowCases: number[][] = [
			[
				128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
				128, 128, 128, 128, 64,
			],
			[
				128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
				128, 128, 128, 128, 32,
			],
			[
				128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
				128, 128, 128, 128, 16,
			],
			[
				128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
				128, 128, 128, 128, 8,
			],
			[
				128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
				128, 128, 128, 128, 4,
			],
		];
		for (const bytes of overflowCases) {
			try {
				decode(Uint8Array.from(bytes));
				throw new Error("expected decode to throw");
			} catch (e) {
				expect(e).toBeInstanceOf(VarintDecodeError);
				expect((e as VarintDecodeError).kind).toBe(VarintError.Overflow);
			}
		}

		const ok = decode(
			Uint8Array.from([
				128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
				128, 128, 128, 128, 2,
			]),
		);
		expect(ok).toEqual([2n ** 127n, 19]);
	});

	test("varints must be terminated", () => {
		try {
			decode(Uint8Array.from([128]));
			throw new Error("expected decode to throw");
		} catch (e) {
			expect(e).toBeInstanceOf(VarintDecodeError);
			expect((e as VarintDecodeError).kind).toBe(VarintError.Unterminated);
		}
	});
});
