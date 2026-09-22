// Ported test-for-test from ord 0.29.0 `crates/ordinals/src/etching.rs` `#[cfg(test)] mod tests`.
import { describe, expect, test } from "bun:test";
import {
	ETCHING_MAX_SPACERS,
	defaultEtching,
	etchingSupply,
} from "./etching.ts";
import { rune, runeToString } from "./rune.ts";
import { spacedRuneFromString } from "./spaced_rune.ts";
import type { Terms } from "./terms.ts";

const U128_MAX = (1n << 128n) - 1n;

describe("Etching", () => {
	test("max_spacers", () => {
		let spacedName = "";
		const runeStr = runeToString(rune(U128_MAX));
		for (let i = 0; i < runeStr.length; i++) {
			if (i > 0) spacedName += "•";
			spacedName += runeStr[i];
		}

		expect(ETCHING_MAX_SPACERS).toBe(spacedRuneFromString(spacedName).spacers);
	});

	test("supply", () => {
		function case_(
			premine: bigint | undefined,
			terms: Terms | undefined,
			supply: bigint | undefined,
		) {
			expect(etchingSupply({ ...defaultEtching(), premine, terms })).toBe(
				supply,
			);
		}

		case_(undefined, undefined, 0n);
		case_(0n, undefined, 0n);
		case_(1n, undefined, 1n);
		case_(
			1n,
			{
				cap: undefined,
				amount: undefined,
				height: [undefined, undefined],
				offset: [undefined, undefined],
			},
			1n,
		);

		case_(
			undefined,
			{
				cap: undefined,
				amount: undefined,
				height: [undefined, undefined],
				offset: [undefined, undefined],
			},
			0n,
		);

		case_(
			U128_MAX / 2n + 1n,
			{
				cap: U128_MAX / 2n,
				amount: 1n,
				height: [undefined, undefined],
				offset: [undefined, undefined],
			},
			U128_MAX,
		);

		case_(
			1000n,
			{
				cap: 10n,
				amount: 100n,
				height: [undefined, undefined],
				offset: [undefined, undefined],
			},
			2000n,
		);

		case_(
			U128_MAX,
			{
				cap: 1n,
				amount: 1n,
				height: [undefined, undefined],
				offset: [undefined, undefined],
			},
			undefined,
		);

		case_(
			0n,
			{
				cap: 1n,
				amount: U128_MAX,
				height: [undefined, undefined],
				offset: [undefined, undefined],
			},
			U128_MAX,
		);
	});
});
