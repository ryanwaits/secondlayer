import { describe, expect, test } from "bun:test";
import type { RuneEntry } from "../runes/entry.ts";
import type { RuneEvent } from "../runes/state.ts";
import { createRuneState } from "../runes/state.ts";
import {
	GENESIS_DIGEST,
	canonicalBlockDelta,
	compareEvents,
	computeBlockDigest,
	computeBlockDigests,
} from "./digest.ts";

function etchEntry(overrides: Partial<RuneEntry> = {}): RuneEntry {
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
		symbol: "⧉",
		terms: {
			amount: 10n,
			cap: 5n,
			height: [840_000n, undefined],
			offset: [undefined, 1000n],
		},
		timestamp: 1_700_000_000n,
		turbo: true,
		...overrides,
	};
}

describe("canonicalBlockDelta", () => {
	test("the same events in a shuffled order produce the same delta", () => {
		const events: RuneEvent[] = [
			{
				kind: "mint",
				height: 840_000,
				txIndex: 3,
				txid: "a".repeat(64),
				runeId: "840000:1",
				amount: 5n,
			},
			{
				kind: "transfer",
				height: 840_000,
				txIndex: 1,
				txid: "b".repeat(64),
				runeId: "840000:2",
				amount: 7n,
				vout: 0,
			},
			{
				kind: "burn",
				height: 840_000,
				txIndex: 1,
				txid: "b".repeat(64),
				runeId: "840000:2",
				amount: 1n,
			},
			{
				kind: "etch",
				height: 840_000,
				txIndex: 1,
				txid: "c".repeat(64),
				runeId: "840000:2",
			},
		];
		const state = createRuneState();
		state.entries.set("840000:2", etchEntry());

		const forward = canonicalBlockDelta(events, state);
		const shuffled = canonicalBlockDelta([...events].reverse(), state);

		expect(shuffled).toBe(forward);
		expect(forward.split("\n")).toHaveLength(4);
	});

	test("an etch line includes the entry fields, so a divisibility change changes the digest", () => {
		const event: RuneEvent = {
			kind: "etch",
			height: 840_000,
			txIndex: 0,
			txid: "a".repeat(64),
			runeId: "840000:0",
		};
		const stateA = createRuneState();
		stateA.entries.set("840000:0", etchEntry({ divisibility: 0 }));
		const stateB = createRuneState();
		stateB.entries.set("840000:0", etchEntry({ divisibility: 8 }));

		expect(canonicalBlockDelta([event], stateA)).not.toBe(
			canonicalBlockDelta([event], stateB),
		);
	});
});

// Plan 057 step 2: `event_index` and `address` are derived fields, computed
// from (and after) the same canonical order/digest — they must never change
// `d_H`, or a rebuild couldn't be proven byte-identical against a pre-057
// digest chain.
describe("the digest chain is unaffected by the plan 057 derived fields", () => {
	test("a transfer event's `address` field doesn't change the delta or d_H", () => {
		const blocks = [{ height: 840_000, hash: "a".repeat(64) }];
		const state = createRuneState();

		const withoutAddress: RuneEvent = {
			kind: "transfer",
			height: 840_000,
			txIndex: 0,
			txid: "b".repeat(64),
			runeId: "840000:0",
			amount: 42n,
			vout: 0,
		};
		const withAddress: RuneEvent = {
			...withoutAddress,
			address: "bc1qay6jxstdwyma44ak8qfu52njqy9ujnfm37hllg",
		};

		const deltaWithout = canonicalBlockDelta([withoutAddress], state);
		const deltaWith = canonicalBlockDelta([withAddress], state);
		expect(deltaWith).toBe(deltaWithout);

		const rowsWithout = computeBlockDigests(
			GENESIS_DIGEST,
			blocks,
			[withoutAddress],
			state,
		);
		const rowsWith = computeBlockDigests(
			GENESIS_DIGEST,
			blocks,
			[withAddress],
			state,
		);
		// biome-ignore lint/style/noNonNullAssertion: one block in, one row out
		expect(rowsWith[0]!.digest).toBe(rowsWithout[0]!.digest);
	});

	test("compareEvents (the event_index sort key) doesn't consult `address`", () => {
		const a: RuneEvent = {
			kind: "transfer",
			height: 840_000,
			txIndex: 0,
			txid: "a".repeat(64),
			runeId: "840000:0",
			amount: 1n,
			vout: 0,
			address: "bc1qay6jxstdwyma44ak8qfu52njqy9ujnfm37hllg",
		};
		const b: RuneEvent = { ...a, address: undefined };
		expect(compareEvents(a, b)).toBe(0);
	});
});

describe("computeBlockDigest", () => {
	test("changing one amount by 1 changes d_H and every later digest", () => {
		const blocks = [
			{ height: 840_000, hash: "a".repeat(64) },
			{ height: 840_001, hash: "b".repeat(64) },
		];
		const state = createRuneState();

		const eventsA: RuneEvent[] = [
			{
				kind: "mint",
				height: 840_000,
				txIndex: 0,
				txid: "c".repeat(64),
				runeId: "840000:0",
				amount: 100n,
			},
		];
		const eventsB: RuneEvent[] = [
			{
				kind: "mint",
				height: 840_000,
				txIndex: 0,
				txid: "c".repeat(64),
				runeId: "840000:0",
				amount: 101n,
			},
		];

		const rowsA = computeBlockDigests(GENESIS_DIGEST, blocks, eventsA, state);
		const rowsB = computeBlockDigests(GENESIS_DIGEST, blocks, eventsB, state);

		// biome-ignore lint/style/noNonNullAssertion: rowsA/rowsB have one row per block
		expect(rowsA[0]!.digest).not.toBe(rowsB[0]!.digest);
		// The change at height 840,000 also changes the chained digest at 840,001.
		// biome-ignore lint/style/noNonNullAssertion: rowsA/rowsB have one row per block
		expect(rowsA[1]!.digest).not.toBe(rowsB[1]!.digest);
	});

	test("the chain links: d_H depends on d_{H-1}", () => {
		const blockHash = internalHashOf("a".repeat(64));
		const digestFromGenesis = computeBlockDigest(GENESIS_DIGEST, blockHash, "");
		const otherPrevious = new Uint8Array(32).fill(9);
		const digestFromOther = computeBlockDigest(otherPrevious, blockHash, "");

		expect(digestFromGenesis).not.toEqual(digestFromOther);
	});
});

// Local helper mirroring internalBytesFromDisplayHash, kept separate so this
// test doesn't depend on that function already being correct.
function internalHashOf(displayHex: string): Uint8Array {
	const bytes = Uint8Array.from(Buffer.from(displayHex, "hex"));
	return bytes.reverse();
}

describe("computeBlockDigests (resume)", () => {
	test("splitting a 5-block run into 3 + 2 (simulating a flush/reload) matches one continuous run", () => {
		const state = createRuneState();
		state.entries.set("840000:0", etchEntry());

		const allBlocks = [
			{ height: 840_000, hash: "0".repeat(64) },
			{ height: 840_001, hash: "1".repeat(64) },
			{ height: 840_002, hash: "2".repeat(64) },
			{ height: 840_003, hash: "3".repeat(64) },
			{ height: 840_004, hash: "4".repeat(64) },
		];
		const allEvents: RuneEvent[] = allBlocks.map((b, i) => ({
			kind: "mint",
			height: b.height,
			txIndex: 0,
			txid: `${i}`.repeat(64),
			runeId: "840000:0",
			amount: BigInt(i + 1),
		}));

		// Straight 5-block run.
		const straight = computeBlockDigests(
			GENESIS_DIGEST,
			allBlocks,
			allEvents,
			state,
		);
		// biome-ignore lint/style/noNonNullAssertion: 5 blocks in, 5 rows out
		const straightFinal = straight.at(-1)!.digest;

		// Split: first 3 blocks (a "flush"), reload the resulting digest, then
		// the last 2 (as a fresh `computeBlockDigests` call would after a
		// process restart that reloaded `state.digest` from the DB).
		const firstThreeBlocks = allBlocks.slice(0, 3);
		const firstThreeEvents = allEvents.slice(0, 3);
		const first = computeBlockDigests(
			GENESIS_DIGEST,
			firstThreeBlocks,
			firstThreeEvents,
			state,
		);
		const reloadedDigest = Uint8Array.from(
			// biome-ignore lint/style/noNonNullAssertion: 3 blocks in, 3 rows out
			Buffer.from(first.at(-1)!.digest, "hex"),
		);

		const lastTwoBlocks = allBlocks.slice(3);
		const lastTwoEvents = allEvents.slice(3);
		const second = computeBlockDigests(
			reloadedDigest,
			lastTwoBlocks,
			lastTwoEvents,
			state,
		);
		// biome-ignore lint/style/noNonNullAssertion: 2 blocks in, 2 rows out
		const splitFinal = second.at(-1)!.digest;

		expect(splitFinal).toBe(straightFinal);
	});
});
