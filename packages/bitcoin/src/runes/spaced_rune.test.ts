// Ported test-for-test from ord 0.29.0 `crates/ordinals/src/spaced_rune.rs` `#[cfg(test)] mod tests`.
// `serde` test not ported: JSON (de)serialization of SpacedRune isn't part of
// the decoder path.
import { describe, expect, test } from "bun:test";
import { rune, runeFromString } from "./rune.ts";
import {
	SpacedRuneParseError,
	spacedRune,
	spacedRuneFromString,
	spacedRuneToString,
} from "./spaced_rune.ts";

describe("SpacedRune", () => {
	test("display", () => {
		expect(spacedRuneToString(spacedRuneFromString("A.B"))).toBe("A•B");
		expect(spacedRuneToString(spacedRuneFromString("A.B.C"))).toBe("A•B•C");
		expect(spacedRuneToString(spacedRune(rune(0n), 1))).toBe("A");
	});

	test("from_str", () => {
		function case_(s: string, runeStr: string, spacers: number) {
			expect(spacedRuneFromString(s)).toEqual({
				rune: runeFromString(runeStr),
				spacers,
			});
		}

		function expectErr(s: string, kind: SpacedRuneParseError["kind"]) {
			try {
				spacedRuneFromString(s);
				throw new Error(`expected ${s} to throw`);
			} catch (e) {
				expect(e).toBeInstanceOf(SpacedRuneParseError);
				expect((e as SpacedRuneParseError).kind).toBe(kind);
			}
		}

		expectErr(".A", "leading-spacer");
		expectErr("A..B", "double-spacer");
		expectErr("A.", "trailing-spacer");
		expectErr("Ax", "character");

		case_("A.B", "AB", 0b1);
		case_("A.B.C", "ABC", 0b11);
		case_("A•B", "AB", 0b1);
		case_("A•B•C", "ABC", 0b11);
		case_("A•BC", "ABC", 0b1);
	});
});
