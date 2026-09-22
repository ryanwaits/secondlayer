// Ported test-for-test from ord 0.29.0 `crates/ordinals/src/runestone/flag.rs` `#[cfg(test)] mod tests`.
import { describe, expect, test } from "bun:test";
import { Flag, flagMask, flagSet, flagTake } from "./flag.ts";

describe("Flag", () => {
	test("mask", () => {
		expect(flagMask(Flag.Etching)).toBe(0b1n);
		expect(flagMask(Flag.Cenotaph)).toBe(1n << 127n);
	});

	test("take", () => {
		const flags1 = { value: 1n };
		expect(flagTake(Flag.Etching, flags1)).toBe(true);
		expect(flags1.value).toBe(0n);

		const flags0 = { value: 0n };
		expect(flagTake(Flag.Etching, flags0)).toBe(false);
		expect(flags0.value).toBe(0n);
	});

	test("set", () => {
		const flags = { value: 0n };
		flagSet(Flag.Etching, flags);
		expect(flags.value).toBe(1n);
	});
});
