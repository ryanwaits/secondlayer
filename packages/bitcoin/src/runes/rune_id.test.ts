// Ported test-for-test from ord 0.29.0 `crates/ordinals/src/rune_id.rs` `#[cfg(test)] mod tests`.
// `serde` test not ported: JSON (de)serialization of RuneId isn't part of the
// decoder path (the DB layer stores rune_id as `block:tx` text via
// runeIdToString/runeIdFromString, exercised by `from_str`/`display` below).
import { describe, expect, test } from "bun:test";
import {
	RuneIdParseError,
	runeIdCompare,
	runeIdDefault,
	runeIdDelta,
	runeIdFromString,
	runeIdNext,
	runeIdToString,
} from "./rune_id.ts";

describe("RuneId", () => {
	test("delta", () => {
		const expected = [
			{ block: 3n, tx: 1n },
			{ block: 4n, tx: 2n },
			{ block: 1n, tx: 2n },
			{ block: 1n, tx: 1n },
			{ block: 3n, tx: 1n },
			{ block: 2n, tx: 0n },
		].sort(runeIdCompare);

		expect(expected).toEqual([
			{ block: 1n, tx: 1n },
			{ block: 1n, tx: 2n },
			{ block: 2n, tx: 0n },
			{ block: 3n, tx: 1n },
			{ block: 3n, tx: 1n },
			{ block: 4n, tx: 2n },
		]);

		let previous = runeIdDefault();
		const deltas: [bigint, bigint][] = [];
		for (const id of expected) {
			const d = runeIdDelta(previous, id);
			expect(d).toBeDefined();
			deltas.push(d as [bigint, bigint]);
			previous = id;
		}

		expect(deltas).toEqual([
			[1n, 1n],
			[0n, 1n],
			[1n, 0n],
			[1n, 1n],
			[0n, 0n],
			[1n, 2n],
		]);

		previous = runeIdDefault();
		const actual = [];
		for (const [block, tx] of deltas) {
			const next = runeIdNext(previous, block, tx);
			expect(next).toBeDefined();
			actual.push(next);
			previous = next as { block: bigint; tx: bigint };
		}

		expect(actual).toEqual(expected);
	});

	test("display", () => {
		expect(runeIdToString({ block: 1n, tx: 2n })).toBe("1:2");
	});

	test("from_str", () => {
		expect(() => runeIdFromString("123")).toThrow(RuneIdParseError);
		try {
			runeIdFromString("123");
		} catch (e) {
			expect((e as RuneIdParseError).kind).toBe("separator");
		}

		try {
			runeIdFromString(":");
		} catch (e) {
			expect((e as RuneIdParseError).kind).toBe("block");
		}

		try {
			runeIdFromString("1:");
		} catch (e) {
			expect((e as RuneIdParseError).kind).toBe("transaction");
		}

		try {
			runeIdFromString(":2");
		} catch (e) {
			expect((e as RuneIdParseError).kind).toBe("block");
		}

		try {
			runeIdFromString("a:2");
		} catch (e) {
			expect((e as RuneIdParseError).kind).toBe("block");
		}

		try {
			runeIdFromString("1:a");
		} catch (e) {
			expect((e as RuneIdParseError).kind).toBe("transaction");
		}

		expect(runeIdFromString("1:2")).toEqual({ block: 1n, tx: 2n });
	});
});
