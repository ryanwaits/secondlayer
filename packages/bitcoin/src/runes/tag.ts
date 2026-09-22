// Ported from ord 0.29.0 `crates/ordinals/src/runestone/tag.rs`.

import { encodeToVec } from "./varint.ts";

export enum Tag {
	Body = 0,
	Flags = 2,
	Rune = 4,
	Premine = 6,
	Cap = 8,
	Amount = 10,
	HeightStart = 12,
	HeightEnd = 14,
	OffsetStart = 16,
	OffsetEnd = 18,
	Mint = 20,
	Pointer = 22,
	Cenotaph = 126,

	Divisibility = 1,
	Spacers = 3,
	Symbol = 5,
	Nop = 127,
}

/**
 * `fields`: tag -> queue of pending values (a `VecDeque<u128>` per tag).
 * `n`: how many leading values `withFn` consumes (Rust's `const N: usize`).
 * Peeks the first `n` values; only drains them if `withFn` returns a value —
 * matching `Tag::take`'s "leave unconsumed values in place on failure" behavior.
 */
export function tagTake<T>(
	tag: Tag,
	fields: Map<bigint, bigint[]>,
	n: number,
	withFn: (values: bigint[]) => T | undefined,
): T | undefined {
	const key = BigInt(tag);
	const field = fields.get(key);
	if (!field || field.length < n) return undefined;

	const values = field.slice(0, n);
	const value = withFn(values);
	if (value === undefined) return undefined;

	field.splice(0, n);
	if (field.length === 0) fields.delete(key);

	return value;
}

export function tagEncode(tag: Tag, values: bigint[], payload: number[]): void {
	for (const value of values) {
		encodeToVec(BigInt(tag), payload);
		encodeToVec(value, payload);
	}
}

export function tagEncodeOption(
	tag: Tag,
	value: bigint | undefined,
	payload: number[],
): void {
	if (value !== undefined) tagEncode(tag, [value], payload);
}
