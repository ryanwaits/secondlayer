// Oracle for the per-block undo payload: synthetic blocks (etch, mint,
// multi-rune transfer to one outpoint, spend, burn, cenotaph, create+spend in
// one block, empty block) driven through the real `applyTransaction`, chained
// on one state. Every block's payload must match the pinned expectation below.
import { describe, expect, test } from "bun:test";
import { addressFromScript } from "../address.ts";
import type { ParsedTx } from "../block.ts";
import type { RuneEntry } from "./entry.ts";
import { Flag, flagMask } from "./flag.ts";
import { rune } from "./rune.ts";
import {
	type RuneState,
	addBurned,
	addMints,
	beginUndoCapture,
	createRuneState,
	endUndoCapture,
	insertEntry,
	setBalance,
	takeOutpointBalances,
} from "./state.ts";
import { Tag } from "./tag.ts";
import { buildUndoPayloadFromSnapshot, snapshotState } from "./undo-oracle.ts";
import {
	type UndoPayload,
	buildUndoPayload,
	undoPayloadFromJson,
	undoPayloadToJson,
} from "./undo.ts";
import {
	type UpdaterContext,
	applyBlockBurns,
	applyTransaction,
} from "./updater.ts";
import { encode } from "./varint.ts";

const OP_RETURN = 0x6a;
const MAGIC_NUMBER = 0x5d;

function runestoneScript(integers: bigint[]): Uint8Array {
	const payload: number[] = [];
	for (const n of integers) payload.push(...encode(n));
	return Uint8Array.from([OP_RETURN, MAGIC_NUMBER, payload.length, ...payload]);
}

/** p2tr-shaped script: derives a mainnet address. `seed` varies it per output. */
function p2tr(seed: number): Uint8Array {
	return Uint8Array.from([0x51, 0x20, ...new Array(32).fill(seed)]);
}
/** A non-OP_RETURN script `addressFromScript` doesn't recognise: no address. */
const NON_STANDARD = Uint8Array.of(0x51);
const BARE_OP_RETURN = Uint8Array.of(OP_RETURN);

function txid(n: number): string {
	return n.toString(16).padStart(64, "0");
}

function tx(
	n: number,
	inputs: Array<[prevTxid: string, prevVout: number]>,
	outputs: Uint8Array[],
): ParsedTx {
	return {
		txid: txid(n),
		txidBytes: new Uint8Array(32),
		wtxidBytes: new Uint8Array(32),
		inputs: inputs.map(([prevTxid, prevVout]) => ({
			prevTxid,
			prevVout,
			witness: [],
		})),
		outputs: outputs.map((script) => ({ value: 0n, script })),
	};
}

const NO_COMMITMENTS = { isConfirmedTaprootCommit: () => false };

const A = "100:0";
const B = "100:1";
const ETCH_TERMS = flagMask(Flag.Etching) | flagMask(Flag.Terms);

interface Block {
	name: string;
	height: number;
	txs: ParsedTx[];
}

const BLOCKS: Block[] = [
	{
		// Two etches in one block: A (terms: 10 per mint, cap 5) and B (no terms,
		// premine to a non-standard output, so its outpoint carries no address).
		name: "etch",
		height: 100,
		txs: [
			tx(
				1,
				[],
				[
					p2tr(1),
					runestoneScript([
						BigInt(Tag.Flags),
						ETCH_TERMS,
						BigInt(Tag.Premine),
						1000n,
						BigInt(Tag.Amount),
						10n,
						BigInt(Tag.Cap),
						5n,
						BigInt(Tag.Pointer),
						0n,
					]),
				],
			),
			tx(
				2,
				[],
				[
					NON_STANDARD,
					runestoneScript([
						BigInt(Tag.Flags),
						flagMask(Flag.Etching),
						BigInt(Tag.Premine),
						500n,
						BigInt(Tag.Pointer),
						0n,
					]),
				],
			),
		],
	},
	{
		// A mint of A, plus a plain spend of both etch outputs into ONE outpoint:
		// a multi-rune outpoint (A and B) with the address inherited from vout 0.
		name: "mint + multi-rune transfer to one outpoint",
		height: 101,
		txs: [
			tx(
				3,
				[],
				[
					p2tr(2),
					runestoneScript([
						BigInt(Tag.Mint),
						100n,
						BigInt(Tag.Mint),
						0n,
						BigInt(Tag.Pointer),
						0n,
					]),
				],
			),
			tx(
				4,
				[
					[txid(1), 0],
					[txid(2), 0],
				],
				[p2tr(3)],
			),
		],
	},
	{
		// Spends the multi-rune outpoint: 300 A to vout 1, the rest to vout 0.
		name: "spend of a multi-rune outpoint via edict",
		height: 102,
		txs: [
			tx(
				5,
				[[txid(4), 0]],
				[
					p2tr(4),
					p2tr(5),
					runestoneScript([BigInt(Tag.Body), 100n, 0n, 300n, 1n]),
				],
			),
		],
	},
	{
		// 100 of the 300 A goes to an OP_RETURN output (burn), the rest to vout 0.
		name: "burn via edict to OP_RETURN",
		height: 103,
		txs: [
			tx(
				6,
				[[txid(5), 1]],
				[
					p2tr(6),
					BARE_OP_RETURN,
					runestoneScript([BigInt(Tag.Body), 100n, 0n, 100n, 1n]),
				],
			),
		],
	},
	{
		name: "cenotaph burns its inputs",
		height: 104,
		txs: [tx(7, [[txid(6), 0]], [runestoneScript([BigInt(Tag.Cenotaph), 0n])])],
	},
	{
		// tx 8 mints to an outpoint that tx 9 spends within the same block: that
		// pair nets out to nothing and must not appear in the payload.
		name: "outpoint created and spent within one block",
		height: 105,
		txs: [
			tx(
				8,
				[],
				[
					p2tr(7),
					runestoneScript([
						BigInt(Tag.Mint),
						100n,
						BigInt(Tag.Mint),
						0n,
						BigInt(Tag.Pointer),
						0n,
					]),
				],
			),
			tx(9, [[txid(8), 0]], [p2tr(8)]),
		],
	},
	{ name: "empty block", height: 106, txs: [] },
];

async function applyBlock(state: RuneState, block: Block): Promise<void> {
	const ctx: UpdaterContext = {
		height: block.height,
		blockTime: 1_700_000_000 + block.height,
		minimum: rune(0n),
		commitments: NO_COMMITMENTS,
	};
	const blockBurned = new Map<string, bigint>();
	for (const [txIndex, t] of block.txs.entries()) {
		await applyTransaction(state, t, txIndex, ctx, blockBurned);
	}
	applyBlockBurns(state, blockBurned);
}

/** Order-insensitive form: the payload's arrays are sets, their order carries no meaning. */
function canonical(payload: UndoPayload): unknown {
	const byKey = <T>(rows: T[], key: (row: T) => string) =>
		[...rows].sort((a, b) => key(a).localeCompare(key(b)));
	return {
		height: payload.height,
		balancesSpent: byKey(
			payload.balancesSpent,
			(r) => `${r.outpoint}|${r.runeId}`,
		).map((r) => ({ ...r, amount: r.amount.toString() })),
		balancesCreated: byKey(
			payload.balancesCreated,
			(r) => `${r.outpoint}|${r.runeId}`,
		),
		entriesEtched: [...payload.entriesEtched].sort(),
		entryDeltas: byKey(payload.entryDeltas, (r) => r.runeId).map((r) => ({
			...r,
			mints: r.mints.toString(),
			burned: r.burned.toString(),
		})),
	};
}

/** Applies every block once, building each block's payload both ways: the full-copy snapshot diff (oracle) and the recorder. */
async function runScenario(): Promise<{
	oracle: Map<string, UndoPayload>;
	recorded: Map<string, UndoPayload>;
}> {
	const state = createRuneState();
	const oracle = new Map<string, UndoPayload>();
	const recorded = new Map<string, UndoPayload>();
	for (const block of BLOCKS) {
		const before = snapshotState(state);
		const recorder = beginUndoCapture(state);
		await applyBlock(state, block);
		endUndoCapture(state);
		oracle.set(
			block.name,
			buildUndoPayloadFromSnapshot(block.height, before, state),
		);
		recorded.set(block.name, buildUndoPayload(block.height, recorder, state));
	}
	return { oracle, recorded };
}

const op = (n: number, vout: number) => `${txid(n)}:${vout}`;
const addrOf = (seed: number) => addressFromScript(p2tr(seed));

/** The pinned payloads, in canonical (sorted) form. */
function expected(): Record<string, unknown> {
	const spent = (
		outpoint: string,
		runeId: string,
		amount: string,
		address: string | undefined,
	) => ({ outpoint, runeId, amount, address });
	const created = (outpoint: string, runeId: string) => ({ outpoint, runeId });
	const empty = {
		balancesSpent: [],
		balancesCreated: [],
		entriesEtched: [],
		entryDeltas: [],
	};
	return {
		etch: {
			...empty,
			height: 100,
			balancesCreated: [created(op(1, 0), A), created(op(2, 0), B)],
			entriesEtched: [A, B],
		},
		"mint + multi-rune transfer to one outpoint": {
			...empty,
			height: 101,
			balancesSpent: [
				spent(op(1, 0), A, "1000", addrOf(1)),
				spent(op(2, 0), B, "500", undefined),
			],
			balancesCreated: [
				created(op(3, 0), A),
				created(op(4, 0), A),
				created(op(4, 0), B),
			],
			entryDeltas: [{ runeId: A, mints: "0", burned: "0" }],
		},
		"spend of a multi-rune outpoint via edict": {
			...empty,
			height: 102,
			balancesSpent: [
				spent(op(4, 0), A, "1000", addrOf(3)),
				spent(op(4, 0), B, "500", addrOf(3)),
			],
			balancesCreated: [
				created(op(5, 0), A),
				created(op(5, 0), B),
				created(op(5, 1), A),
			],
		},
		"burn via edict to OP_RETURN": {
			...empty,
			height: 103,
			balancesSpent: [spent(op(5, 1), A, "300", addrOf(5))],
			balancesCreated: [created(op(6, 0), A)],
			entryDeltas: [{ runeId: A, mints: "1", burned: "0" }],
		},
		"cenotaph burns its inputs": {
			...empty,
			height: 104,
			balancesSpent: [spent(op(6, 0), A, "200", addrOf(6))],
			entryDeltas: [{ runeId: A, mints: "1", burned: "100" }],
		},
		"outpoint created and spent within one block": {
			...empty,
			height: 105,
			balancesCreated: [created(op(9, 0), A)],
			entryDeltas: [{ runeId: A, mints: "1", burned: "300" }],
		},
		"empty block": { ...empty, height: 106 },
	};
}

describe("undo payload oracle", () => {
	test("every block's payload matches the pinned expectation, both ways", async () => {
		const { oracle, recorded } = await runScenario();
		const want = expected();
		expect([...oracle.keys()]).toEqual(Object.keys(want));
		for (const payloads of [oracle, recorded]) {
			for (const [name, payload] of payloads) {
				expect({ name, payload: canonical(payload) }).toEqual({
					name,
					payload: want[name],
				});
			}
		}
	});

	test("the recorder's payload equals the snapshot diff, block by block, including its JSON form", async () => {
		const { oracle, recorded } = await runScenario();
		for (const [name, payload] of oracle) {
			const other = recorded.get(name) as UndoPayload;
			expect(canonical(other)).toEqual(canonical(payload));
			expect(
				canonical(undoPayloadFromJson(other.height, undoPayloadToJson(other))),
			).toEqual(canonical(payload));
		}
	});

	test("random blocks over shared balances and entries: recorder equals snapshot diff", () => {
		// Deterministic LCG so a failure reproduces.
		let seed = 0x2545f491;
		const next = (n: number) => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed % n;
		};
		const runeIds = ["10:0", "10:1", "10:2", "11:0"];
		const outpoints = Array.from(
			{ length: 24 },
			(_, i) => `${txid(i)}:${i % 3}`,
		);
		const state = createRuneState();
		for (const [i, id] of runeIds.entries()) {
			insertEntry(state, id, {
				block: 10n,
				burned: 0n,
				divisibility: 0,
				etching: txid(900 + i),
				mints: 0n,
				number: BigInt(i),
				premine: 0n,
				rune: BigInt(1000 + i),
				spacers: 0,
				symbol: undefined,
				terms: undefined,
				timestamp: 0n,
				turbo: false,
			});
		}
		let etched = 100;

		for (let height = 1; height <= 300; height++) {
			const before = snapshotState(state);
			const recorder = beginUndoCapture(state);
			for (let op = 0; op < 1 + next(12); op++) {
				const outpoint = outpoints[next(outpoints.length)] as string;
				const runeId = runeIds[next(runeIds.length)] as string;
				const kind = next(6);
				if (kind === 0) {
					takeOutpointBalances(state, outpoint);
				} else if (kind === 1) {
					setBalance(state, outpoint, runeId, 0n);
				} else if (kind === 2) {
					addMints(state, runeId, 1n);
				} else if (kind === 3) {
					addBurned(state, runeId, BigInt(1 + next(5)));
				} else if (kind === 4) {
					const id = `${height}:${etched++}`;
					runeIds.push(id);
					insertEntry(state, id, {
						...(state.entries.get(runeId) as RuneEntry),
						mints: 0n,
						burned: 0n,
						number: BigInt(etched),
						rune: BigInt(etched + 5000),
					});
				} else {
					const address = next(2) === 0 ? undefined : `bc1q${next(5)}`;
					setBalance(state, outpoint, runeId, BigInt(1 + next(50)), address);
				}
			}
			endUndoCapture(state);
			expect(canonical(buildUndoPayload(height, recorder, state))).toEqual(
				canonical(buildUndoPayloadFromSnapshot(height, before, state)),
			);
		}
	});
});
