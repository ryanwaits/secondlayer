// Pins `RuneState`'s balance bookkeeping: a synthetic etch / mint /
// multi-rune transfer / spend / rewind sequence must leave `liveSupply`
// equal to a from-scratch sum of every balance, and must reproduce the state
// hashes the pre-compaction implementation produced. The two expected hashes
// below were captured from that implementation before the balance storage
// was changed, so a representation change that alters what the digest chain
// sees fails here.
import { describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { computeStateHash } from "../integrity/digest.ts";
import type { RuneEntry } from "./entry.ts";
import {
	type RuneState,
	createRuneState,
	getBalance,
	setBalance,
	takeOutpointBalances,
} from "./state.ts";
import { applyUndoPayload, buildUndoPayload, snapshotState } from "./undo.ts";

const ADDR_A = "bc1qay6jxstdwyma44ak8qfu52njqy9ujnfm37hllg";
const ADDR_B = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";
const RUNE_A = "840000:1";
const RUNE_B = "840000:2";

const BLOCK_ONE_HASH =
	"3a3c1fa7b45eaac6219b0a4023e13f59035b61a735d5cd2448fe62aba716f249";
const BLOCK_TWO_HASH =
	"8075c901a9a7f7102b1a4303b7e93e58d5b5466f82d541c732e8710df88cd3c2";

function op(letter: string, vout: number): string {
	return `${letter.repeat(64)}:${vout}`;
}

function entry(number: bigint, rune: bigint, premine: bigint): RuneEntry {
	return {
		block: 840_000n,
		burned: 0n,
		divisibility: 0,
		etching: "e".repeat(64),
		mints: 0n,
		number,
		premine,
		rune,
		spacers: 0,
		symbol: undefined,
		terms: undefined,
		timestamp: 1_700_000_000n,
		turbo: false,
	};
}

function hashOf(state: RuneState): string {
	return bytesToHex(computeStateHash(state));
}

/** Sum of every live balance of `runeId`, walked from the balances themselves. */
function fromScratchSupply(state: RuneState, runeId: string): bigint {
	let total = 0n;
	for (const byRune of state.balances.values()) {
		total += byRune.get(runeId) ?? 0n;
	}
	return total;
}

function liveSupplyOf(state: RuneState, runeId: string): bigint {
	return state.liveSupply.get(runeId) ?? 0n;
}

function expectSupplyConsistent(state: RuneState): void {
	for (const runeId of [RUNE_A, RUNE_B]) {
		expect(liveSupplyOf(state, runeId)).toBe(fromScratchSupply(state, runeId));
	}
	// A rune with no balances must not linger as a zero entry.
	for (const total of state.liveSupply.values()) expect(total > 0n).toBe(true);
}

/** Block 1: etch two runes with premines and a mint, spread over several outpoints. */
function applyBlockOne(state: RuneState): void {
	state.entries.set(RUNE_A, entry(0n, 111n, 1000n));
	state.entries.set(RUNE_B, entry(1n, 222n, 300n));
	state.runeToId.set("111", RUNE_A);
	state.runeToId.set("222", RUNE_B);
	setBalance(state, op("1", 0), RUNE_A, 1000n, ADDR_A); // premine
	setBalance(state, op("1", 1), RUNE_B, 300n, ADDR_B); // premine
	setBalance(state, op("2", 0), RUNE_A, 500n, ADDR_A); // mint
	setBalance(state, op("2", 0), RUNE_A, 500n); // same amount rewritten
}

/** Block 2: multi-rune transfer to one outpoint, spends, and in-block churn. */
function applyBlockTwo(state: RuneState): void {
	const a = takeOutpointBalances(state, op("1", 0));
	const b = takeOutpointBalances(state, op("1", 1));
	expect(a.get(RUNE_A)).toBe(1000n);
	expect(b.get(RUNE_B)).toBe(300n);
	// Two runes land on one outpoint.
	setBalance(state, op("3", 0), RUNE_A, 700n, ADDR_B);
	setBalance(state, op("3", 0), RUNE_B, 300n);
	// Change output with no derivable address.
	setBalance(state, op("3", 1), RUNE_A, 300n);
	// Spend the mint output entirely, re-creating it elsewhere in two steps.
	takeOutpointBalances(state, op("2", 0));
	setBalance(state, op("4", 0), RUNE_A, 200n, ADDR_A);
	setBalance(state, op("4", 0), RUNE_A, 500n);
	// Created and spent inside the same block.
	setBalance(state, op("5", 0), RUNE_B, 9n, ADDR_A);
	takeOutpointBalances(state, op("5", 0));
	// Partial reduction of a multi-rune outpoint, then restored.
	setBalance(state, op("3", 0), RUNE_B, 100n);
	setBalance(state, op("3", 0), RUNE_B, 300n);
}

describe("RuneState balances", () => {
	test("liveSupply tracks a from-scratch sum through etch, mint, multi-rune transfer, spend and rewind", () => {
		const state = createRuneState();
		applyBlockOne(state);
		expectSupplyConsistent(state);
		expect(liveSupplyOf(state, RUNE_A)).toBe(1500n);
		expect(liveSupplyOf(state, RUNE_B)).toBe(300n);
		expect(hashOf(state)).toBe(BLOCK_ONE_HASH);

		const before = snapshotState(state);
		applyBlockTwo(state);
		expectSupplyConsistent(state);
		expect(liveSupplyOf(state, RUNE_A)).toBe(1500n);
		expect(liveSupplyOf(state, RUNE_B)).toBe(300n);
		expect(getBalance(state, op("3", 0), RUNE_A)).toBe(700n);
		expect(getBalance(state, op("3", 0), RUNE_B)).toBe(300n);
		expect(state.balances.has(op("5", 0))).toBe(false);
		expect(hashOf(state)).toBe(BLOCK_TWO_HASH);

		applyUndoPayload(state, buildUndoPayload(840_002, before, state));
		expectSupplyConsistent(state);
		expect(liveSupplyOf(state, RUNE_A)).toBe(1500n);
		expect(hashOf(state)).toBe(BLOCK_ONE_HASH);
	});
});
