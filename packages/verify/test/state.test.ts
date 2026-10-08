import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type BlockStateInput,
	type StateWrite,
	type VmEventRow,
	hex,
	marfPath,
	parseWitness,
	unhex,
	verifyBlockState,
} from "../src/index.ts";
import { type WitnessFixture, listFixtures, readJson } from "./fixtures.ts";

const utf8Hex = (s: string) => hex(new TextEncoder().encode(s));

// Local stackslib chain: block id at height j = u64 BE (j + 1), zero padded.
const blockIdAt = (j: number) => {
	const b = new Uint8Array(32);
	new DataView(b.buffer).setBigUint64(0, BigInt(j + 1));
	return b;
};
const marfU32 = (n: number) => {
	const v = new Uint8Array(40);
	new DataView(v.buffer).setUint32(0, n, true);
	return hex(v);
};

/** Parent-state oracle for the local chain: bookkeeping below `height` plus the fixture's carried values. */
function parentState(fx: WitnessFixture): Map<string, string> {
	const state = new Map(Object.entries(fx.carried_parent_values));
	for (let j = 0; j < fx.height; j++) {
		const id = hex(blockIdAt(j));
		state.set(
			hex(marfPath(`__MARF_BLOCK_HEIGHT_TO_HASH::${j}`)),
			`${id}${"00".repeat(8)}`,
		);
		state.set(hex(marfPath(`__MARF_BLOCK_HASH_TO_HEIGHT::${id}`)), marfU32(j));
	}
	return state;
}

const local = listFixtures("witness").map((f) => {
	const fx = readJson<WitnessFixture>(`witness/${f}`);
	const state = parentState(fx);
	const input: BlockStateInput = {
		height: fx.height,
		parentBlockId: unhex(fx.parent),
		stateRoot: unhex(fx.expected_root),
		witness: unhex(fx.witness),
		writes: fx.writes.map(([key, value], i) => ({
			tx_index: 0,
			ordinal: i,
			key,
			value_hex: utf8Hex(value),
		})),
		parentHolds: async (leaf) =>
			state.get(hex(leaf.path)) === `${hex(leaf.valueHash)}${"00".repeat(8)}`,
	};
	return { name: f.slice(0, -5), fx, input };
});

describe("verifyBlockState on local stackslib witnesses", () => {
	for (const { name, fx, input } of local)
		test(`${name}: every leaf is a named write, carried, or MARF bookkeeping`, async () => {
			const r = await verifyBlockState(input);
			expect(r.failures).toEqual([]);
			const d = r.diff;
			if (!d) throw new Error("no diff");
			expect(d.named).toBe(true);
			expect(d.writes.length).toBe(fx.expect.writes);
			expect(d.writes.every((w) => w.named && w.key && w.txIndex === 0)).toBe(
				true,
			);
			// The block's 5 bookkeeping entries are derived; older ones are copy-on-write carries.
			expect(d.internal.length).toBe(5);
			expect(d.carried.length + d.internal.length).toBe(
				fx.expect.carried + fx.expect.internal_leaves,
			);
		});

	const { input } = local.find(
		(c) => c.fx.expect.carried > 0,
	) as (typeof local)[number];
	const writes = input.writes as StateWrite[];
	const omitted = writes[0] as StateWrite;

	test("a witness whose root differs from the header root is refused", async () => {
		const root = input.stateRoot.slice();
		root[0] = (root[0] as number) ^ 1;
		const r = await verifyBlockState({ ...input, stateRoot: root });
		expect(r.diff).toBeUndefined();
		expect(r.failures.map((f) => [f.step, f.code])).toEqual([
			["witness", "root-mismatch"],
		]);
	});

	test("malformed witness bytes fail the witness step", async () => {
		const r = await verifyBlockState({
			...input,
			witness: input.witness.subarray(0, 40),
		});
		expect(r.failures[0]).toMatchObject({ step: "witness", code: "malformed" });
	});

	test("a write left out of state_writes is a hidden write", async () => {
		const r = await verifyBlockState({ ...input, writes: writes.slice(1) });
		expect(r.failures).toEqual([
			{
				step: "names",
				code: "hidden-write",
				message: expect.any(String),
				path: hex(marfPath(omitted.key)),
			},
		]);
	});

	test("a state write with a forged value is missing and its leaf hidden", async () => {
		const forged = writes.map((w) =>
			w === omitted ? { ...w, value_hex: utf8Hex("forged") } : w,
		);
		const r = await verifyBlockState({ ...input, writes: forged });
		expect(r.failures.map((f) => f.code).sort()).toEqual([
			"hidden-write",
			"missing-write",
		]);
	});

	test("only the last write to a key must hold the leaf's value", async () => {
		const earlier = { ...omitted, ordinal: -1, value_hex: utf8Hex("stale") };
		const r = await verifyBlockState({
			...input,
			writes: [earlier, ...writes],
		});
		expect(r.failures).toEqual([]);
	});

	test("carried leaves the parent does not hold are hidden writes", async () => {
		const r = await verifyBlockState({
			...input,
			parentHolds: async () => false,
		});
		expect(r.failures.length).toBeGreaterThan(0);
		expect(r.failures.every((f) => f.code === "hidden-write")).toBe(true);
	});

	test("a state write value that is not UTF-8 is a bad write", async () => {
		const bad = [...writes, { ...omitted, ordinal: 9999, value_hex: "ff" }];
		const r = await verifyBlockState({ ...input, writes: bad });
		expect(r.failures.map((f) => f.code)).toContain("bad-write");
	});
});

// Mainnet block 1,230,200: v3 witness from the Rust extractor plus the two
// vm_events rows the feeder stored for it (ordinal 19 has the old key bug).
const MAINNET =
	"68df6083cbf08375d57a27aed303e9bb95c101ce9b08813aa519ba6887a730f2";
const dir = join(import.meta.dir, "fixtures", "witness-rust");
const meta = JSON.parse(readFileSync(join(dir, `${MAINNET}.json`), "utf8"));
const mainnetWitness = new Uint8Array(
	readFileSync(join(dir, `${MAINNET}.witness`)),
);

interface FeederRow {
	ordinal: number;
	type: VmEventRow["event_type"];
	tx_id: string;
	data: {
		contract_identifier: string;
		map_name: string;
		raw_key: string;
		raw_value: string;
	};
}
/** Feeder `vm_events` rows reshaped as the Index API serves them. */
const rows: VmEventRow[] = readFileSync(
	join(dir, "vm-1230200-rows.jsonl"),
	"utf8",
)
	.split("\n")
	.filter(Boolean)
	.map((l) => JSON.parse(l) as FeederRow)
	.map((r) => ({
		event_type: r.type,
		event_index: r.ordinal,
		tx_id: r.tx_id,
		contract_id: r.data.contract_identifier,
		map: r.data.map_name,
		raw_key: r.data.raw_key,
		raw_value: r.data.raw_value,
	}));

describe("verifyBlockState on mainnet block 1,230,200", () => {
	// No header fixture for this block, so the parent id comes from the
	// witness's own HEIGHT_TO_HASH::{h-1} leaf and the root from the extractor.
	const parentLeaf = parseWitness(mainnetWitness).leaves.find(
		(l) =>
			hex(l.path) === hex(marfPath("__MARF_BLOCK_HEIGHT_TO_HASH::1230199")),
	);
	const base: BlockStateInput = {
		height: 1230200,
		parentBlockId: parentLeaf?.valueHash as Uint8Array,
		stateRoot: unhex(meta.root_hex),
		witness: mainnetWitness,
		writes: null,
		rows,
		parentHolds: async () => {
			throw new Error("unnamed blocks never ask the parent");
		},
	};

	test("without state_writes the diff is proven but unnamed", async () => {
		const r = await verifyBlockState(base);
		const d = r.diff;
		if (!d) throw new Error("no diff");
		expect(d.named).toBe(false);
		expect(d.internal.length).toBe(5);
		expect(d.writes.length).toBe(10);
		expect(d.writes.every((w) => !w.named && w.key === undefined)).toBe(true);
		expect(d.carried).toEqual([]);
		expect(r.notes[0]).toContain("no state_writes");
	});

	test("the buggy reserve row names a key the block never wrote", async () => {
		const r = await verifyBlockState(base);
		expect(r.rowsChecked).toBe(2);
		expect(r.failures).toEqual([
			expect.objectContaining({
				step: "rows",
				code: "key-not-written",
				ordinal: 19,
			}),
		]);
	});

	test("the row as the fixed collector emits it proves against its leaf", async () => {
		const fixed = rows.map((r) =>
			r.event_index === 19
				? {
						...r,
						raw_key:
							"0x0616402da2c079e5d31d58b9cfc7286d1b1eb2f7834e0b746f6b656e2d776b696b69",
					}
				: r,
		);
		const r = await verifyBlockState({ ...base, rows: fixed });
		expect(r.failures).toEqual([]);
	});

	test("a row whose value differs from the leaf is a value mismatch", async () => {
		const forged = rows.map((r) =>
			r.event_index === 22 ? { ...r, raw_value: `${r.raw_value}00` } : r,
		);
		const r = await verifyBlockState({ ...base, rows: forged });
		expect(r.failures.map((f) => [f.ordinal, f.code])).toEqual([
			[19, "key-not-written"],
			[22, "value-mismatch"],
		]);
	});
});
