// Ported test-for-test from ord 0.29.0 `src/index/entry.rs` `#[cfg(test)] mod tests`
// (RuneEntry::mintable / ::supply subset — everything else in that file is
// redb storage (de)serialization, not decoder logic).
import { describe, expect, test } from "bun:test";
import {
	MintErrorKind,
	type RuneEntry,
	runeEntryMintable,
	runeEntrySupply,
} from "./entry.ts";

function defaultEntry(): RuneEntry {
	return {
		block: 0n,
		burned: 0n,
		divisibility: 0,
		etching: "0".repeat(64),
		mints: 0n,
		number: 0n,
		premine: 0n,
		rune: 0n,
		spacers: 0,
		symbol: undefined,
		terms: undefined,
		timestamp: 0n,
		turbo: false,
	};
}

describe("RuneEntry", () => {
	test("mintable_default", () => {
		expect(runeEntryMintable(defaultEntry(), 0n)).toEqual({
			err: { kind: MintErrorKind.Unmintable, value: undefined },
		});
	});

	test("mintable_cap", () => {
		expect(
			runeEntryMintable(
				{
					...defaultEntry(),
					terms: {
						cap: 1n,
						amount: 1000n,
						height: [undefined, undefined],
						offset: [undefined, undefined],
					},
					mints: 0n,
				},
				0n,
			),
		).toEqual({ ok: 1000n });

		expect(
			runeEntryMintable(
				{
					...defaultEntry(),
					terms: {
						cap: 1n,
						amount: 1000n,
						height: [undefined, undefined],
						offset: [undefined, undefined],
					},
					mints: 1n,
				},
				0n,
			),
		).toEqual({ err: { kind: MintErrorKind.Cap, value: 1n } });

		expect(
			runeEntryMintable(
				{
					...defaultEntry(),
					terms: {
						cap: undefined,
						amount: 1000n,
						height: [undefined, undefined],
						offset: [undefined, undefined],
					},
					mints: 0n,
				},
				0n,
			),
		).toEqual({ err: { kind: MintErrorKind.Cap, value: 0n } });
	});

	test("mintable_offset_start", () => {
		const entry: RuneEntry = {
			...defaultEntry(),
			block: 1n,
			terms: {
				cap: 1n,
				amount: 1000n,
				height: [undefined, undefined],
				offset: [1n, undefined],
			},
			mints: 0n,
		};

		expect(runeEntryMintable(entry, 1n)).toEqual({
			err: { kind: MintErrorKind.Start, value: 2n },
		});
		expect(runeEntryMintable(entry, 2n)).toEqual({ ok: 1000n });
	});

	test("mintable_offset_end", () => {
		const entry: RuneEntry = {
			...defaultEntry(),
			block: 1n,
			terms: {
				cap: 1n,
				amount: 1000n,
				height: [undefined, undefined],
				offset: [undefined, 1n],
			},
			mints: 0n,
		};

		expect(runeEntryMintable(entry, 1n)).toEqual({ ok: 1000n });
		expect(runeEntryMintable(entry, 2n)).toEqual({
			err: { kind: MintErrorKind.End, value: 2n },
		});
	});

	test("mintable_height_start", () => {
		const entry: RuneEntry = {
			...defaultEntry(),
			terms: {
				cap: 1n,
				amount: 1000n,
				height: [1n, undefined],
				offset: [undefined, undefined],
			},
			mints: 0n,
		};

		expect(runeEntryMintable(entry, 0n)).toEqual({
			err: { kind: MintErrorKind.Start, value: 1n },
		});
		expect(runeEntryMintable(entry, 1n)).toEqual({ ok: 1000n });
	});

	test("mintable_height_end", () => {
		const entry: RuneEntry = {
			...defaultEntry(),
			terms: {
				cap: 1n,
				amount: 1000n,
				height: [undefined, 1n],
				offset: [undefined, undefined],
			},
			mints: 0n,
		};

		expect(runeEntryMintable(entry, 0n)).toEqual({ ok: 1000n });
		expect(runeEntryMintable(entry, 1n)).toEqual({
			err: { kind: MintErrorKind.End, value: 1n },
		});
	});

	test("mintable_multiple_terms", () => {
		const base: RuneEntry = {
			...defaultEntry(),
			terms: { cap: 1n, amount: 1000n, height: [10n, 20n], offset: [0n, 10n] },
			block: 10n,
			mints: 0n,
		};

		expect(runeEntryMintable(base, 10n)).toEqual({ ok: 1000n });

		expect(
			runeEntryMintable(
				{
					...base,
					terms: {
						...(base.terms as NonNullable<RuneEntry["terms"]>),
						cap: undefined,
					},
				},
				10n,
			),
		).toEqual({ err: { kind: MintErrorKind.Cap, value: 0n } });

		expect(
			runeEntryMintable(
				{
					...base,
					terms: {
						...(base.terms as NonNullable<RuneEntry["terms"]>),
						height: [
							11n,
							(base.terms as NonNullable<RuneEntry["terms"]>).height[1],
						],
					},
				},
				10n,
			),
		).toEqual({ err: { kind: MintErrorKind.Start, value: 11n } });

		expect(
			runeEntryMintable(
				{
					...base,
					terms: {
						...(base.terms as NonNullable<RuneEntry["terms"]>),
						height: [
							(base.terms as NonNullable<RuneEntry["terms"]>).height[0],
							10n,
						],
					},
				},
				10n,
			),
		).toEqual({ err: { kind: MintErrorKind.End, value: 10n } });

		expect(
			runeEntryMintable(
				{
					...base,
					terms: {
						...(base.terms as NonNullable<RuneEntry["terms"]>),
						offset: [
							1n,
							(base.terms as NonNullable<RuneEntry["terms"]>).offset[1],
						],
					},
				},
				10n,
			),
		).toEqual({ err: { kind: MintErrorKind.Start, value: 11n } });

		expect(
			runeEntryMintable(
				{
					...base,
					terms: {
						...(base.terms as NonNullable<RuneEntry["terms"]>),
						offset: [
							(base.terms as NonNullable<RuneEntry["terms"]>).offset[0],
							0n,
						],
					},
				},
				10n,
			),
		).toEqual({ err: { kind: MintErrorKind.End, value: 10n } });
	});

	test("supply", () => {
		expect(
			runeEntrySupply({
				...defaultEntry(),
				terms: {
					amount: 1000n,
					cap: undefined,
					height: [undefined, undefined],
					offset: [undefined, undefined],
				},
				mints: 0n,
			}),
		).toBe(0n);

		expect(
			runeEntrySupply({
				...defaultEntry(),
				terms: {
					amount: 1000n,
					cap: undefined,
					height: [undefined, undefined],
					offset: [undefined, undefined],
				},
				mints: 1n,
			}),
		).toBe(1000n);

		expect(
			runeEntrySupply({
				...defaultEntry(),
				terms: {
					amount: 1000n,
					cap: undefined,
					height: [undefined, undefined],
					offset: [undefined, undefined],
				},
				mints: 0n,
				premine: 1n,
			}),
		).toBe(1n);

		expect(
			runeEntrySupply({
				...defaultEntry(),
				terms: {
					amount: 1000n,
					cap: undefined,
					height: [undefined, undefined],
					offset: [undefined, undefined],
				},
				mints: 1n,
				premine: 1n,
			}),
		).toBe(1001n);
	});
});
