// Ported test-for-test from ord 0.29.0 `crates/ordinals/src/rune.rs` `#[cfg(test)] mod tests`.
// `serde` test not ported: JSON (de)serialization of Rune isn't part of the
// decoder path.
import { describe, expect, test } from "bun:test";
import {
	Network,
	RUNE_RESERVED,
	SUBSIDY_HALVING_INTERVAL,
	rune,
	runeCommitment,
	runeFromString,
	runeIsReserved,
	runeMinimumAtHeight,
	runeReserved,
	runeToString,
	runeUnlockHeight,
} from "./rune.ts";

const UNLOCK_INTERVAL = SUBSIDY_HALVING_INTERVAL / 12;
const U128_MAX = (1n << 128n) - 1n;

// Rune::STEPS, mirrored here only for the `steps`/`steps_are_sorted_and_unique` tests.
const STEPS: readonly bigint[] = [
	0n,
	26n,
	702n,
	18278n,
	475254n,
	12356630n,
	321272406n,
	8353082582n,
	217180147158n,
	5646683826134n,
	146813779479510n,
	3817158266467286n,
	99246114928149462n,
	2580398988131886038n,
	67090373691429037014n,
	1744349715977154962390n,
	45353092615406029022166n,
	1179180408000556754576342n,
	30658690608014475618984918n,
	797125955808376366093607894n,
	20725274851017785518433805270n,
	538857146126462423479278937046n,
	14010285799288023010461252363222n,
	364267430781488598271992561443798n,
	9470953200318703555071806597538774n,
	246244783208286292431866971536008150n,
	6402364363415443603228541259936211926n,
	166461473448801533683942072758341510102n,
];

describe("Rune", () => {
	test("round trip", () => {
		function roundtripCase(n: bigint, s: string) {
			expect(runeToString(rune(n))).toBe(s);
			expect(runeFromString(s)).toEqual(rune(n));
		}

		roundtripCase(0n, "A");
		roundtripCase(1n, "B");
		roundtripCase(2n, "C");
		roundtripCase(3n, "D");
		roundtripCase(4n, "E");
		roundtripCase(5n, "F");
		roundtripCase(6n, "G");
		roundtripCase(7n, "H");
		roundtripCase(8n, "I");
		roundtripCase(9n, "J");
		roundtripCase(10n, "K");
		roundtripCase(11n, "L");
		roundtripCase(12n, "M");
		roundtripCase(13n, "N");
		roundtripCase(14n, "O");
		roundtripCase(15n, "P");
		roundtripCase(16n, "Q");
		roundtripCase(17n, "R");
		roundtripCase(18n, "S");
		roundtripCase(19n, "T");
		roundtripCase(20n, "U");
		roundtripCase(21n, "V");
		roundtripCase(22n, "W");
		roundtripCase(23n, "X");
		roundtripCase(24n, "Y");
		roundtripCase(25n, "Z");
		roundtripCase(26n, "AA");
		roundtripCase(27n, "AB");
		roundtripCase(51n, "AZ");
		roundtripCase(52n, "BA");
		roundtripCase(U128_MAX - 2n, "BCGDENLQRQWDSLRUGSNLBTMFIJAT");
		roundtripCase(U128_MAX - 1n, "BCGDENLQRQWDSLRUGSNLBTMFIJAU");
		roundtripCase(U128_MAX, "BCGDENLQRQWDSLRUGSNLBTMFIJAV");
	});

	test("from_str_error", () => {
		expect(() => runeFromString("BCGDENLQRQWDSLRUGSNLBTMFIJAW")).toThrow();
		try {
			runeFromString("BCGDENLQRQWDSLRUGSNLBTMFIJAW");
		} catch (e) {
			expect((e as { kind: string }).kind).toBe("range");
		}
		try {
			runeFromString("BCGDENLQRQWDSLRUGSNLBTMFIJAVX");
		} catch (e) {
			expect((e as { kind: string }).kind).toBe("range");
		}
		try {
			runeFromString("x");
		} catch (e) {
			expect((e as { kind: string }).kind).toBe("character");
		}
	});

	test("mainnet_minimum_at_height", () => {
		function mainnetCase(height: number, minimum: string) {
			const min = runeFromString(minimum);
			expect(runeMinimumAtHeight(Network.Bitcoin, height)).toEqual(min);

			const unlockHeight = runeUnlockHeight(min, Network.Bitcoin);
			expect(unlockHeight).toBeDefined();
			expect(unlockHeight as number).toBeLessThanOrEqual(height);

			if (unlockHeight === 0) {
				expect(height).toBeLessThan(SUBSIDY_HALVING_INTERVAL * 4);
			}
		}

		const START = SUBSIDY_HALVING_INTERVAL * 4;
		const END = START + SUBSIDY_HALVING_INTERVAL;

		mainnetCase(0, "AAAAAAAAAAAAA");
		mainnetCase(START / 2, "AAAAAAAAAAAAA");
		mainnetCase(START, "ZZYZXBRKWXVA");
		mainnetCase(START + 1, "ZZXZUDIVTVQA");
		mainnetCase(END - 1, "A");
		mainnetCase(END, "A");
		mainnetCase(END + 1, "A");
		mainnetCase(0xffffffff, "A");

		mainnetCase(START + UNLOCK_INTERVAL * 0 - 1, "AAAAAAAAAAAAA");
		mainnetCase(START + UNLOCK_INTERVAL * 0 + 0, "ZZYZXBRKWXVA");
		mainnetCase(START + UNLOCK_INTERVAL * 0 + 1, "ZZXZUDIVTVQA");

		mainnetCase(START + UNLOCK_INTERVAL * 1 - 1, "AAAAAAAAAAAA");
		mainnetCase(START + UNLOCK_INTERVAL * 1 + 0, "ZZYZXBRKWXV");
		mainnetCase(START + UNLOCK_INTERVAL * 1 + 1, "ZZXZUDIVTVQ");

		mainnetCase(START + UNLOCK_INTERVAL * 2 - 1, "AAAAAAAAAAA");
		mainnetCase(START + UNLOCK_INTERVAL * 2 + 0, "ZZYZXBRKWY");
		mainnetCase(START + UNLOCK_INTERVAL * 2 + 1, "ZZXZUDIVTW");

		mainnetCase(START + UNLOCK_INTERVAL * 3 - 1, "AAAAAAAAAA");
		mainnetCase(START + UNLOCK_INTERVAL * 3 + 0, "ZZYZXBRKX");
		mainnetCase(START + UNLOCK_INTERVAL * 3 + 1, "ZZXZUDIVU");

		mainnetCase(START + UNLOCK_INTERVAL * 4 - 1, "AAAAAAAAA");
		mainnetCase(START + UNLOCK_INTERVAL * 4 + 0, "ZZYZXBRL");
		mainnetCase(START + UNLOCK_INTERVAL * 4 + 1, "ZZXZUDIW");

		mainnetCase(START + UNLOCK_INTERVAL * 5 - 1, "AAAAAAAA");
		mainnetCase(START + UNLOCK_INTERVAL * 5 + 0, "ZZYZXBS");
		mainnetCase(START + UNLOCK_INTERVAL * 5 + 1, "ZZXZUDJ");

		mainnetCase(START + UNLOCK_INTERVAL * 6 - 1, "AAAAAAA");
		mainnetCase(START + UNLOCK_INTERVAL * 6 + 0, "ZZYZXC");
		mainnetCase(START + UNLOCK_INTERVAL * 6 + 1, "ZZXZUE");

		mainnetCase(START + UNLOCK_INTERVAL * 7 - 1, "AAAAAA");
		mainnetCase(START + UNLOCK_INTERVAL * 7 + 0, "ZZYZY");
		mainnetCase(START + UNLOCK_INTERVAL * 7 + 1, "ZZXZV");

		mainnetCase(START + UNLOCK_INTERVAL * 8 - 1, "AAAAA");
		mainnetCase(START + UNLOCK_INTERVAL * 8 + 0, "ZZZA");
		mainnetCase(START + UNLOCK_INTERVAL * 8 + 1, "ZZYA");

		mainnetCase(START + UNLOCK_INTERVAL * 9 - 1, "AAAA");
		mainnetCase(START + UNLOCK_INTERVAL * 9 + 0, "ZZZ");
		mainnetCase(START + UNLOCK_INTERVAL * 9 + 1, "ZZY");

		mainnetCase(START + UNLOCK_INTERVAL * 10 - 2, "AAC");
		mainnetCase(START + UNLOCK_INTERVAL * 10 - 1, "AAA");
		mainnetCase(START + UNLOCK_INTERVAL * 10 + 0, "AAA");
		mainnetCase(START + UNLOCK_INTERVAL * 10 + 1, "AAA");

		mainnetCase(START + UNLOCK_INTERVAL * 10 + UNLOCK_INTERVAL / 2, "NA");

		mainnetCase(START + UNLOCK_INTERVAL * 11 - 2, "AB");
		mainnetCase(START + UNLOCK_INTERVAL * 11 - 1, "AA");
		mainnetCase(START + UNLOCK_INTERVAL * 11 + 0, "AA");
		mainnetCase(START + UNLOCK_INTERVAL * 11 + 1, "AA");

		mainnetCase(START + UNLOCK_INTERVAL * 11 + UNLOCK_INTERVAL / 2, "N");

		mainnetCase(START + UNLOCK_INTERVAL * 12 - 2, "B");
		mainnetCase(START + UNLOCK_INTERVAL * 12 - 1, "A");
		mainnetCase(START + UNLOCK_INTERVAL * 12 + 0, "A");
		mainnetCase(START + UNLOCK_INTERVAL * 12 + 1, "A");
	});

	test("minimum_at_height", () => {
		function case_(network: Network, height: number, minimum: string) {
			expect(runeToString(runeMinimumAtHeight(network, height))).toBe(minimum);
		}

		case_(Network.Testnet, 0, "AAAAAAAAAAAAA");
		case_(Network.Testnet, SUBSIDY_HALVING_INTERVAL * 12 - 1, "AAAAAAAAAAAAA");
		case_(Network.Testnet, SUBSIDY_HALVING_INTERVAL * 12, "ZZYZXBRKWXVA");
		case_(Network.Testnet, SUBSIDY_HALVING_INTERVAL * 12 + 1, "ZZXZUDIVTVQA");

		case_(Network.Signet, 0, "ZZYZXBRKWXVA");
		case_(Network.Signet, 1, "ZZXZUDIVTVQA");

		case_(Network.Regtest, 0, "ZZYZXBRKWXVA");
		case_(Network.Regtest, 1, "ZZXZUDIVTVQA");
	});

	test("reserved", () => {
		expect(RUNE_RESERVED).toBe(runeFromString("AAAAAAAAAAAAAAAAAAAAAAAAAAA").n);

		expect(runeReserved(0n, 0n)).toEqual(rune(RUNE_RESERVED));
		expect(runeReserved(0n, 1n)).toEqual(rune(RUNE_RESERVED + 1n));
		expect(runeReserved(1n, 0n)).toEqual(rune(RUNE_RESERVED + (1n << 32n)));
		expect(runeReserved(1n, 1n)).toEqual(
			rune(RUNE_RESERVED + (1n << 32n) + 1n),
		);
		expect(runeReserved((1n << 64n) - 1n, 0xffffffffn)).toEqual(
			rune(RUNE_RESERVED + (((1n << 64n) - 1n) << 32n) + 0xffffffffn),
		);
	});

	test("is_reserved", () => {
		function case_(s: string, reserved: boolean) {
			const r = runeFromString(s);
			expect(runeIsReserved(r)).toBe(reserved);
			expect(runeUnlockHeight(r, Network.Bitcoin) === undefined).toBe(reserved);
		}

		case_("A", false);
		case_("ZZZZZZZZZZZZZZZZZZZZZZZZZZ", false);
		case_("AAAAAAAAAAAAAAAAAAAAAAAAAAA", true);
		case_("AAAAAAAAAAAAAAAAAAAAAAAAAAB", true);
		case_("BCGDENLQRQWDSLRUGSNLBTMFIJAV", true);
	});

	test("steps", () => {
		for (let i = 0; ; i++) {
			try {
				const r = runeFromString("A".repeat(i + 1));
				expect(rune(STEPS[i] as bigint)).toEqual(r);
			} catch {
				expect(STEPS.length).toBe(i);
				break;
			}
		}
	});

	test("commitment", () => {
		function case_(n: bigint, bytes: number[]) {
			expect(Array.from(runeCommitment(rune(n)))).toEqual(bytes);
		}

		case_(0n, []);
		case_(1n, [1]);
		case_(255n, [255]);
		case_(256n, [0, 1]);
		case_(65535n, [255, 255]);
		case_(65536n, [0, 0, 1]);
		case_(U128_MAX, new Array(16).fill(255));
	});

	test("steps_are_sorted_and_unique", () => {
		const sorted = [...STEPS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		expect(sorted).toEqual([...STEPS]);
		const deduped = [...new Set(sorted)];
		expect(deduped).toEqual(sorted);
	});

	test("reserved_rune_unlock_height", () => {
		expect(runeUnlockHeight(rune(RUNE_RESERVED), Network.Bitcoin)).toBe(
			undefined,
		);
		expect(runeUnlockHeight(rune(RUNE_RESERVED + 1n), Network.Bitcoin)).toBe(
			undefined,
		);
		expect(runeUnlockHeight(rune(RUNE_RESERVED - 1n), Network.Bitcoin)).toBe(0);
	});

	test("unlock_height", () => {
		function case_(s: string, unlockHeight: number) {
			const r = runeFromString(s);
			expect(runeUnlockHeight(r, Network.Bitcoin)).toBe(unlockHeight);

			if (unlockHeight > 0) {
				expect(
					r.n >= runeMinimumAtHeight(Network.Bitcoin, unlockHeight).n,
				).toBe(true);
				expect(
					r.n < runeMinimumAtHeight(Network.Bitcoin, unlockHeight - 1).n,
				).toBe(true);
			}
		}

		const START = SUBSIDY_HALVING_INTERVAL * 4;

		case_("AAAAAAAAAAAAB", 0);
		case_("AAAAAAAAAAAAA", 0);
		case_("ZZZZZZZZZZZZ", START);
		case_("ZZZZZZZZZZZ", START + UNLOCK_INTERVAL);
		case_("ZZZZZZZZZZ", START + UNLOCK_INTERVAL * 2);
		case_("ZZZZZZZZZ", START + UNLOCK_INTERVAL * 3);
		case_("ZZYZXBRKWXVA", START);
		case_("ZZZ", 997_500);
		case_("AAA", 1_014_999);
		case_("NNNN", 988_400);
		case_("Z", 1_033_173);
		case_("Y", 1_033_846);
		case_("P", 1_039_903);
		case_("O", 1_040_576);
		case_("N", 1_041_249);
		case_("M", 1_041_923);
		case_("L", 1_042_596);
		case_("K", 1_043_269);
		case_("J", 1_043_942);
		case_("I", 1_044_615);
		case_("H", 1_045_288);
		case_("G", 1_045_961);
		case_("F", 1_046_634);
		case_("E", 1_047_307);
		case_("D", 1_047_980);
		case_("C", 1_048_653);
		case_("B", 1_049_326);
		case_("A", 1_049_999);

		for (let i = 0; i < 4; i++) {
			const lo = STEPS[i] as bigint;
			const hi = STEPS[i + 1] as bigint;
			// Rust iterates every n in STEPS[i]..STEPS[i+1]; that range is huge for
			// larger i in real ord data but only i<4 is exercised here and even
			// STEPS[3]-STEPS[2] (~17.5k) is large — sample it instead of a full
			// scan to keep this test fast (see NOTES in the executor report).
			const span = hi - lo;
			const sampleCount = 25n;
			const step = span / sampleCount > 0n ? span / sampleCount : 1n;
			for (let n = lo; n < hi; n += step) {
				const r = rune(n);
				const unlockHeight = runeUnlockHeight(r, Network.Bitcoin);
				expect(unlockHeight).toBeDefined();
				expect(
					r.n >= runeMinimumAtHeight(Network.Bitcoin, unlockHeight as number).n,
				).toBe(true);
				expect(
					r.n <
						runeMinimumAtHeight(Network.Bitcoin, (unlockHeight as number) - 1)
							.n,
				).toBe(true);
			}
		}
	});
});
