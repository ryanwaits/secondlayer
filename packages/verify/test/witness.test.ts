import { describe, expect, test } from "bun:test";
import {
	type BlockDiffInput,
	classifyBlockDiff,
	hex,
	marfPath,
	marfValue,
	parseWitness,
	unhex,
} from "../src/index.ts";
import { type WitnessFixture, listFixtures, readJson } from "./fixtures.ts";

// Fixture chain (local stackslib MARF): block id at height j = u64 BE (j + 1), zero padded.
const blockIdAt = (j: number) => {
	const b = new Uint8Array(32);
	new DataView(b.buffer).setBigUint64(0, BigInt(j + 1));
	return hex(b);
};
const marfU32 = (n: number) => {
	const v = new Uint8Array(40);
	new DataView(v.buffer).setUint32(0, n, true);
	return hex(v);
};

/**
 * `__MARF_*` bookkeeping for every height up to `height`, derived from the
 * header chain (height <-> block id). Copy-on-write carries older entries into
 * trie N, so a block can hold internal leaves for past heights too.
 */
function chainInternal(height: number): [string, string][] {
	const out: [string, string][] = [];
	for (let j = 0; j <= height; j++) {
		out.push([
			`__MARF_BLOCK_HEIGHT_TO_HASH::${j}`,
			`${blockIdAt(j)}${"00".repeat(8)}`,
		]);
		out.push([`__MARF_BLOCK_HASH_TO_HEIGHT::${blockIdAt(j)}`, marfU32(j)]);
	}
	out.push(["__MARF_BLOCK_HEIGHT_SELF", marfU32(height)]);
	return out;
}

const cases = listFixtures("witness").map((f) => {
	const fx = readJson<WitnessFixture>(`witness/${f}`);
	const witness = parseWitness(unhex(fx.witness));
	const input: BlockDiffInput = {
		leaves: witness.leaves,
		writes: fx.writes,
		internal: chainInternal(fx.height),
		parentValue: (p) => fx.carried_parent_values[p],
	};
	return { name: f.slice(0, -5), fx, witness, input };
});

describe("parseWitness", () => {
	for (const { name, fx, witness } of cases)
		test(`${name}: recomputed root equals the MARF root`, () => {
			expect(hex(witness.root)).toBe(fx.expected_root);
			expect(witness.leaves.length).toBe(
				fx.expect.writes + fx.expect.carried + fx.expect.internal_leaves,
			);
		});

	test("fixture internal keys are a subset of the header-chain derivation", () => {
		for (const { fx } of cases) {
			const derived = new Map(chainInternal(fx.height));
			for (const [k, v] of fx.internal) expect(derived.get(k)).toBe(v);
		}
	});

	const { fx } = cases[0] as (typeof cases)[number];
	const bytes = unhex(fx.witness);

	test("a flipped leaf value byte changes the root", () => {
		const tampered = bytes.slice();
		const at = tampered.length - 5;
		tampered[at] = (tampered[at] as number) ^ 1;
		expect(hex(parseWitness(tampered).root)).not.toBe(fx.expected_root);
	});

	test("a flipped ancestor root changes the root", () => {
		const tampered = bytes.slice();
		// v3: version (1) + u32 ancestor count (4), so the first ancestor root starts at byte 5
		tampered[5] = (tampered[5] as number) ^ 1;
		expect(hex(parseWitness(tampered).root)).not.toBe(fx.expected_root);
	});

	test("trailing bytes are rejected", () => {
		const padded = new Uint8Array(bytes.length + 1);
		padded.set(bytes);
		expect(() => parseWitness(padded)).toThrow("trailing");
	});

	test("truncated witness is rejected", () => {
		expect(() => parseWitness(bytes.subarray(0, bytes.length - 1))).toThrow();
	});

	test("unknown version is rejected", () => {
		const v1 = bytes.slice();
		v1[0] = 1;
		expect(() => parseWitness(v1)).toThrow("version");
	});
});

describe("classifyBlockDiff", () => {
	for (const { name, fx, input } of cases)
		test(`${name}: every leaf is a claimed write, carried, or internal`, () => {
			const d = classifyBlockDiff(input);
			expect(d.writes.length).toBe(fx.expect.writes);
			expect(d.carried.length).toBe(fx.expect.carried);
			expect(d.internal.length).toBe(fx.expect.internal_leaves);
			expect(d.hidden).toEqual([]);
			expect(d.missing).toEqual([]);
			expect(d.complete).toBe(true);
		});

	const { input } = cases.find(
		(c) => c.fx.expect.carried > 0,
	) as (typeof cases)[number];
	const [key, value] = input.writes[0] as [string, string];
	const pathHex = hex(marfPath(key));

	test("an omitted write surfaces as a hidden leaf", () => {
		const d = classifyBlockDiff({ ...input, writes: input.writes.slice(1) });
		expect(d.hidden.map((l) => hex(l.path))).toEqual([pathHex]);
		expect(d.complete).toBe(false);
	});

	test("a write claimed with a different value is missing and its leaf hidden", () => {
		const writes = input.writes.map(([k, v]): [string, string] =>
			k === key ? [k, `${v}-forged`] : [k, v],
		);
		const d = classifyBlockDiff({ ...input, writes });
		expect(d.missing).toEqual([key]);
		expect(d.hidden.map((l) => hex(l.path))).toEqual([pathHex]);
		expect(d.complete).toBe(false);
	});

	test("a claimed write with no leaf in the block is missing", () => {
		const d = classifyBlockDiff({
			...input,
			writes: [...input.writes, ["vm::SP000.c0::0::m::never-written", "u1"]],
		});
		expect(d.missing).toEqual(["vm::SP000.c0::0::m::never-written"]);
		expect(d.complete).toBe(false);
	});

	test("a real write relabeled as carried is caught when the parent value differs", () => {
		const prior = hex(marfValue(`${value}-before`));
		const d = classifyBlockDiff({
			...input,
			writes: input.writes.slice(1),
			parentValue: (p) => (p === pathHex ? prior : input.parentValue(p)),
		});
		expect(d.hidden.map((l) => hex(l.path))).toEqual([pathHex]);
		expect(d.carried.length).toBe(classifyBlockDiff(input).carried.length);
	});

	test("a carried leaf without a proven parent value is hidden", () => {
		const d = classifyBlockDiff({ ...input, parentValue: () => undefined });
		expect(d.carried).toEqual([]);
		expect(d.hidden.length).toBe(classifyBlockDiff(input).carried.length);
	});

	test("dropping MARF bookkeeping leaves them hidden", () => {
		const d = classifyBlockDiff({ ...input, internal: [] });
		expect(d.internal).toEqual([]);
		expect(d.hidden.length).toBeGreaterThanOrEqual(5);
	});

	test("internal entries must be __MARF_ keys", () => {
		expect(() =>
			classifyBlockDiff({
				...input,
				internal: [[key, hex(marfValue(value))]],
			}),
		).toThrow("__MARF_");
	});

	test("duplicate claimed keys are refused", () => {
		expect(() =>
			classifyBlockDiff({ ...input, writes: [...input.writes, [key, value]] }),
		).toThrow("duplicate");
	});
});
