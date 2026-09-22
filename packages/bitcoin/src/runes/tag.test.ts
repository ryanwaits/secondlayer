// Ported test-for-test from ord 0.29.0 `crates/ordinals/src/runestone/tag.rs` `#[cfg(test)] mod tests`.
// `from_u128`/`partial_eq` collapse into one trivial check: Tag is a plain
// numeric TS enum, so `Tag.Body === 0` needs no ported round trip.
import { describe, expect, test } from "bun:test";
import { Tag, tagEncode, tagTake } from "./tag.ts";

describe("Tag", () => {
	test("values match ord's Tag discriminants", () => {
		expect(Tag.Body as number).toBe(0);
		expect(Tag.Flags as number).toBe(2);
	});

	test("take", () => {
		const fields = new Map<bigint, bigint[]>([[2n, [3n]]]);

		expect(tagTake(Tag.Flags, fields, 1, () => undefined)).toBeUndefined();

		expect(fields.size).toBeGreaterThan(0);

		expect(tagTake(Tag.Flags, fields, 1, ([flags]) => flags)).toBe(3n);

		expect(fields.size).toBe(0);

		expect(tagTake(Tag.Flags, fields, 1, ([flags]) => flags)).toBeUndefined();
	});

	test("take_leaves_unconsumed_values", () => {
		const fields = new Map<bigint, bigint[]>([[2n, [1n, 2n, 3n]]]);

		expect(fields.get(2n)?.length).toBe(3);

		expect(tagTake(Tag.Flags, fields, 1, () => undefined)).toBeUndefined();

		expect(fields.get(2n)?.length).toBe(3);

		expect(
			tagTake(Tag.Flags, fields, 2, ([a, b]) => [a, b] as [bigint, bigint]),
		).toEqual([1n, 2n]);

		expect(fields.get(2n)?.length).toBe(1);

		expect(tagTake(Tag.Flags, fields, 1, ([a]) => a)).toBe(3n);

		expect(fields.get(2n)).toBeUndefined();
	});

	test("encode", () => {
		const payload: number[] = [];

		tagEncode(Tag.Flags, [3n], payload);
		expect(payload).toEqual([2, 3]);

		tagEncode(Tag.Rune, [5n], payload);
		expect(payload).toEqual([2, 3, 4, 5]);

		tagEncode(Tag.Rune, [5n, 6n], payload);
		expect(payload).toEqual([2, 3, 4, 5, 4, 5, 4, 6]);
	});

	test("burn_and_nop_are_one_byte", () => {
		const payload1: number[] = [];
		tagEncode(Tag.Cenotaph, [0n], payload1);
		expect(payload1.length).toBe(2);

		const payload2: number[] = [];
		tagEncode(Tag.Nop, [0n], payload2);
		expect(payload2.length).toBe(2);
	});
});
