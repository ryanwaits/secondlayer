// Behavioral tests for the ported `rune_updater.rs` state machine (updater.ts),
// per plan step 4: etch+premine, mint within/after cap, edict-to-OP_RETURN
// burn, cenotaph burns all inputs, invariant fail-closed, continuity
// fail-closed (continuity is backfill.ts's concern — see backfill.test.ts).
import { describe, expect, test } from "bun:test";
import type { ParsedTx } from "../block.ts";
import type { BitcoinRpcClient } from "../rpc.ts";
import { Flag, flagMask } from "./flag.ts";
import { InvariantViolationError, checkInvariant } from "./invariant.ts";
import { rune } from "./rune.ts";
import { runeIdToString } from "./rune_id.ts";
import { createRuneState, getBalance, setBalance } from "./state.ts";
import { Tag } from "./tag.ts";
import {
	type UpdaterContext,
	applyBlockBurns,
	applyTransaction,
} from "./updater.ts";
import { encode } from "./varint.ts";

const OP_RETURN = 0x6a;
const MAGIC_NUMBER = 0x5d;

function pushSlice(bytes: Uint8Array): number[] {
	const out: number[] = [];
	const len = bytes.length;
	if (len <= 0x4b) out.push(len);
	else if (len <= 0xff) out.push(0x4c, len);
	else throw new Error("test helper doesn't support pushes this large");
	out.push(...bytes);
	return out;
}

function runestoneScript(integers: bigint[]): Uint8Array {
	const payload: number[] = [];
	for (const n of integers) payload.push(...encode(n));
	return Uint8Array.from([
		OP_RETURN,
		MAGIC_NUMBER,
		...pushSlice(Uint8Array.from(payload)),
	]);
}

/** A non-OP_RETURN, non-empty placeholder scriptPubKey (arbitrary, just not OP_RETURN-prefixed). */
function placeholderScript(): Uint8Array {
	return Uint8Array.from([0x51, 0x20, ...new Array(32).fill(1)]); // looks like a p2tr output; content irrelevant to the updater
}

function bareOpReturn(): Uint8Array {
	return Uint8Array.from([OP_RETURN]);
}

const unreachableRpc: BitcoinRpcClient = {
	getblockcount: () => {
		throw new Error("unexpected RPC call in this test");
	},
	getblockhash: () => {
		throw new Error("unexpected RPC call in this test");
	},
	getblock: () => {
		throw new Error("unexpected RPC call in this test");
	},
	getblockheader: () => {
		throw new Error("unexpected RPC call in this test");
	},
	getrawtransaction: () => {
		throw new Error("unexpected RPC call in this test");
	},
};

function ctx(height: number): UpdaterContext {
	return {
		height,
		blockTime: 1_700_000_000,
		minimum: rune(0n),
		rpc: unreachableRpc,
	};
}

describe("applyTransaction", () => {
	test("etch with premine to the pointer output: balance and entry supply match", async () => {
		const state = createRuneState();

		// Flags=Etching, Premine=1000, Pointer=0 (no Rune tag -> auto-reserved name).
		const script = runestoneScript([
			BigInt(Tag.Flags),
			flagMask(Flag.Etching),
			BigInt(Tag.Premine),
			1000n,
			BigInt(Tag.Pointer),
			0n,
		]);

		const tx: ParsedTx = {
			txid: "a".repeat(64),
			inputs: [],
			outputs: [
				{ value: 0n, script: placeholderScript() },
				{ value: 0n, script },
			],
		};

		const blockBurned = new Map<string, bigint>();
		await applyTransaction(state, tx, 0, ctx(840_000), blockBurned);
		applyBlockBurns(state, blockBurned);

		const ruleId = runeIdToString({ block: 840_000n, tx: 0n });
		const entry = state.entries.get(ruleId);
		expect(entry).toBeDefined();
		expect(entry?.premine).toBe(1000n);
		expect(entry?.mints).toBe(0n);
		expect(entry?.burned).toBe(0n);

		const outpoint = `${tx.txid}:0`;
		expect(getBalance(state, outpoint, ruleId)).toBe(1000n);

		checkInvariant(state, [ruleId]);
	});

	test("mint within terms increments mints; a mint after the cap does not", async () => {
		const state = createRuneState();
		const ruleId = runeIdToString({ block: 800_000n, tx: 1n });
		state.entries.set(ruleId, {
			block: 800_000n,
			burned: 0n,
			divisibility: 0,
			etching: "b".repeat(64),
			mints: 0n,
			number: 0n,
			premine: 0n,
			rune: 12345n,
			spacers: 0,
			symbol: undefined,
			terms: {
				amount: 500n,
				cap: 1n,
				height: [undefined, undefined],
				offset: [undefined, undefined],
			},
			timestamp: 0n,
			turbo: false,
		});

		const mintScript = runestoneScript([
			BigInt(Tag.Mint),
			800_000n,
			BigInt(Tag.Mint),
			1n,
		]);
		const mintTx: ParsedTx = {
			txid: "c".repeat(64),
			inputs: [],
			outputs: [
				{ value: 0n, script: placeholderScript() },
				{ value: 0n, script: mintScript },
			],
		};

		const blockBurned1 = new Map<string, bigint>();
		await applyTransaction(state, mintTx, 0, ctx(800_001), blockBurned1);
		applyBlockBurns(state, blockBurned1);

		expect(state.entries.get(ruleId)?.mints).toBe(1n);
		expect(getBalance(state, `${mintTx.txid}:0`, ruleId)).toBe(500n);

		// second mint attempt, same rune — cap already reached, must not increment
		const mintTx2: ParsedTx = {
			txid: "d".repeat(64),
			inputs: [],
			outputs: [
				{ value: 0n, script: placeholderScript() },
				{ value: 0n, script: mintScript },
			],
		};
		const blockBurned2 = new Map<string, bigint>();
		await applyTransaction(state, mintTx2, 0, ctx(800_002), blockBurned2);
		applyBlockBurns(state, blockBurned2);

		expect(state.entries.get(ruleId)?.mints).toBe(1n);
		expect(getBalance(state, `${mintTx2.txid}:0`, ruleId)).toBe(0n);

		checkInvariant(state, [ruleId]);
	});

	test("edict to an OP_RETURN output increments burned", async () => {
		const state = createRuneState();

		// Flags=Etching, Premine=100, edict id=(0,0) [the rune being etched] amount=100 output=1 (a bare OP_RETURN).
		const script = runestoneScript([
			BigInt(Tag.Flags),
			flagMask(Flag.Etching),
			BigInt(Tag.Premine),
			100n,
			BigInt(Tag.Body),
			0n,
			0n,
			100n,
			1n,
		]);

		const tx: ParsedTx = {
			txid: "e".repeat(64),
			inputs: [],
			outputs: [
				{ value: 0n, script: placeholderScript() }, // 0: default output (unused destination)
				{ value: 0n, script: bareOpReturn() }, // 1: edict target — burns
				{ value: 0n, script }, // 2: the runestone carrier itself
			],
		};

		const blockBurned = new Map<string, bigint>();
		await applyTransaction(state, tx, 0, ctx(840_000), blockBurned);
		applyBlockBurns(state, blockBurned);

		const ruleId = runeIdToString({ block: 840_000n, tx: 0n });
		const entry = state.entries.get(ruleId);
		expect(entry?.burned).toBe(100n);
		expect(entry?.premine).toBe(100n);
		expect(getBalance(state, `${tx.txid}:1`, ruleId)).toBe(0n); // burned, not held as a balance
		expect(getBalance(state, `${tx.txid}:0`, ruleId)).toBe(0n); // nothing left to reach the default output

		checkInvariant(state, [ruleId]);
	});

	test("a cenotaph burns all input runes", async () => {
		const state = createRuneState();

		const ruleId = runeIdToString({ block: 700_000n, tx: 3n });
		state.entries.set(ruleId, {
			block: 700_000n,
			burned: 0n,
			divisibility: 0,
			etching: "f".repeat(64),
			mints: 0n,
			number: 0n,
			premine: 50n,
			rune: 999n,
			spacers: 0,
			symbol: undefined,
			terms: undefined,
			timestamp: 0n,
			turbo: false,
		});

		const prevTxid = "1".repeat(64);
		setBalance(state, `${prevTxid}:0`, ruleId, 50n);
		// setBalance marks the entry dirty for the invariant check, which is fine —
		// it also marks the outpoint dirty, which flush() would upsert; harmless here.

		// A runestone with an unrecognized even tag deciphers to a Cenotaph.
		const script = runestoneScript([BigInt(Tag.Cenotaph), 0n]);

		const tx: ParsedTx = {
			txid: "2".repeat(64),
			inputs: [{ prevTxid, prevVout: 0, witness: [] }],
			outputs: [{ value: 0n, script }],
		};

		const blockBurned = new Map<string, bigint>();
		await applyTransaction(state, tx, 0, ctx(700_010), blockBurned);
		applyBlockBurns(state, blockBurned);

		expect(state.entries.get(ruleId)?.burned).toBe(50n);
		expect(getBalance(state, `${prevTxid}:0`, ruleId)).toBe(0n);

		checkInvariant(state, [ruleId]);
	});
});

describe("checkInvariant", () => {
	test("throws when sum(balances) + burned is off by one", () => {
		const state = createRuneState();
		const ruleId = runeIdToString({ block: 900_000n, tx: 0n });
		state.entries.set(ruleId, {
			block: 900_000n,
			burned: 0n,
			divisibility: 0,
			etching: "3".repeat(64),
			mints: 0n,
			number: 0n,
			premine: 100n,
			rune: 42n,
			spacers: 0,
			symbol: undefined,
			terms: undefined,
			timestamp: 0n,
			turbo: false,
		});
		setBalance(state, `${"4".repeat(64)}:0`, ruleId, 99n); // should be 100 to match premine

		expect(() => checkInvariant(state, [ruleId])).toThrow(
			InvariantViolationError,
		);
	});
});
