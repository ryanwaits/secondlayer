// Pure (no DB) tests for the undo journal: build a payload from a
// before/after snapshot pair, then prove applying it reverses exactly that
// block's effect — using `computeStateHash` (not raw object equality) since
// housekeeping fields (dirty sets, event buffers) legitimately differ by
// flush history without the *logical* state differing (see
// `../integrity/digest.ts`'s docstring on `canonicalStateDump`).
import { describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { computeStateHash } from "../integrity/digest.ts";
import type { RuneEntry } from "./entry.ts";
import { type RuneState, createRuneState, setBalance } from "./state.ts";
import {
	applyUndoPayload,
	buildUndoPayload,
	snapshotState,
	undoPayloadFromJson,
	undoPayloadToJson,
} from "./undo.ts";

function stateHash(state: RuneState): string {
	return bytesToHex(computeStateHash(state));
}

function baseEntry(overrides: Partial<RuneEntry> = {}): RuneEntry {
	return {
		block: 840_000n,
		burned: 0n,
		divisibility: 0,
		etching: "a".repeat(64),
		mints: 0n,
		number: 0n,
		premine: 1000n,
		rune: 123n,
		spacers: 0,
		symbol: undefined,
		terms: undefined,
		timestamp: 1_700_000_000n,
		turbo: false,
		...overrides,
	};
}

const ADDRESS = "bc1qay6jxstdwyma44ak8qfu52njqy9ujnfm37hllg";

describe("buildUndoPayload + applyUndoPayload", () => {
	test("a plain balance transfer round-trips: undo restores the pre-block amount", () => {
		const state = createRuneState();
		state.entries.set("840000:0", baseEntry());
		state.runeToId.set("123", "840000:0");
		const outpoint = `${"a".repeat(64)}:0`;
		setBalance(state, outpoint, "840000:0", 100n, ADDRESS);

		const before = snapshotState(state);
		const afterHash = stateHash(state); // "before this block" == current state, since nothing has moved yet

		// Block: moves the balance to a new outpoint.
		setBalance(state, outpoint, "840000:0", 0n);
		const newOutpoint = `${"b".repeat(64)}:0`;
		setBalance(state, newOutpoint, "840000:0", 100n, ADDRESS);

		const payload = buildUndoPayload(840_001, before, state);
		applyUndoPayload(state, payload);

		expect(stateHash(state)).toBe(afterHash);
		expect(state.balances.get(outpoint)?.get("840000:0")).toBe(100n);
		expect(state.balances.has(newOutpoint)).toBe(false);
		expect(state.balanceAddresses.get(outpoint)).toBe(ADDRESS);
	});

	test("a newly etched rune is deleted entirely on undo (not just its balance)", () => {
		const state = createRuneState();
		const beforeHash = stateHash(state);
		const before = snapshotState(state);

		// Block: etches a new rune with a premine balance.
		const entry = baseEntry({ number: 0n });
		state.entries.set("840000:5", entry);
		state.runeToId.set("123", "840000:5");
		state.statisticRunes = 1n;
		const outpoint = `${"c".repeat(64)}:0`;
		setBalance(state, outpoint, "840000:5", 1000n, ADDRESS);

		expect(state.entries.has("840000:5")).toBe(true);

		const payload = buildUndoPayload(840_001, before, state);
		expect(payload.entriesEtched).toEqual(["840000:5"]);

		applyUndoPayload(state, payload);

		expect(state.entries.has("840000:5")).toBe(false);
		expect(state.runeToId.has("123")).toBe(false);
		expect(state.statisticRunes).toBe(0n);
		expect(state.balances.has(outpoint)).toBe(false);
		expect(stateHash(state)).toBe(beforeHash);
	});

	test("mints/burned deltas on a pre-existing rune are restored, not just zeroed", () => {
		const state = createRuneState();
		state.entries.set("840000:0", baseEntry({ mints: 3n, burned: 2n }));
		const beforeHash = stateHash(state);
		const before = snapshotState(state);

		// Block: two more mints and a burn.
		const entry = state.entries.get("840000:0") as RuneEntry;
		entry.mints += 2n;
		entry.burned += 1n;

		const payload = buildUndoPayload(840_001, before, state);
		expect(payload.entryDeltas).toEqual([
			{ runeId: "840000:0", mints: 3n, burned: 2n },
		]);
		expect(payload.entriesEtched).toEqual([]);

		applyUndoPayload(state, payload);

		expect(state.entries.get("840000:0")?.mints).toBe(3n);
		expect(state.entries.get("840000:0")?.burned).toBe(2n);
		expect(stateHash(state)).toBe(beforeHash);
	});

	test("applying blocks A, B, C then undoing C and B matches the state after A alone", () => {
		const runeId = "840000:0";
		function applyA(state: RuneState): void {
			state.entries.set(runeId, baseEntry());
			state.runeToId.set("123", runeId);
			state.statisticRunes = 1n;
			setBalance(state, `${"a".repeat(64)}:0`, runeId, 1000n, ADDRESS);
		}
		function applyB(state: RuneState): void {
			// spend the block-A output into two new ones
			setBalance(state, `${"a".repeat(64)}:0`, runeId, 0n);
			setBalance(state, `${"b".repeat(64)}:0`, runeId, 400n, ADDRESS);
			setBalance(state, `${"b".repeat(64)}:1`, runeId, 600n);
			const entry = state.entries.get(runeId) as RuneEntry;
			entry.mints += 1n;
		}
		function applyC(state: RuneState): void {
			setBalance(state, `${"b".repeat(64)}:1`, runeId, 0n);
			const entry = state.entries.get(runeId) as RuneEntry;
			entry.burned += 100n;
		}

		// Reference: state after A alone.
		const reference = createRuneState();
		applyA(reference);
		const referenceHash = stateHash(reference);

		// A, B, C, then undo C, then undo B.
		const state = createRuneState();
		applyA(state);

		const beforeB = snapshotState(state);
		applyB(state);
		const payloadB = buildUndoPayload(840_001, beforeB, state);

		const beforeC = snapshotState(state);
		applyC(state);
		const payloadC = buildUndoPayload(840_002, beforeC, state);

		applyUndoPayload(state, payloadC);
		applyUndoPayload(state, payloadB);

		expect(stateHash(state)).toBe(referenceHash);
	});

	test("a key untouched by the block never appears in the payload", () => {
		const state = createRuneState();
		state.entries.set("840000:0", baseEntry());
		setBalance(state, `${"a".repeat(64)}:0`, "840000:0", 50n);

		const before = snapshotState(state);
		// No-op block.
		const payload = buildUndoPayload(840_001, before, state);

		expect(payload.balancesSpent).toEqual([]);
		expect(payload.balancesCreated).toEqual([]);
		expect(payload.entriesEtched).toEqual([]);
		expect(payload.entryDeltas).toEqual([]);
	});
});

describe("undoPayloadToJson / undoPayloadFromJson", () => {
	test("round-trips bigints as decimal strings without precision loss", () => {
		const u128Max = (1n << 128n) - 1n;
		const payload = {
			height: 840_001,
			balancesSpent: [
				{
					outpoint: `${"a".repeat(64)}:0`,
					runeId: "840000:0",
					amount: u128Max,
					address: ADDRESS,
				},
				{
					outpoint: `${"b".repeat(64)}:1`,
					runeId: "840000:1",
					amount: 0n,
					address: undefined,
				},
			],
			balancesCreated: [
				{ outpoint: `${"c".repeat(64)}:2`, runeId: "840000:2" },
			],
			entriesEtched: ["840000:3"],
			entryDeltas: [{ runeId: "840000:4", mints: u128Max, burned: 1n }],
		};

		const json = undoPayloadToJson(payload);
		const roundTripped = undoPayloadFromJson(payload.height, json);

		expect(roundTripped).toEqual(payload);
		expect(JSON.parse(JSON.stringify(json))).toEqual(json); // no bigint survives a real JSON.stringify
	});
});
