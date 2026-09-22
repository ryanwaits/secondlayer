// Ported from ord 0.29.0 `src/index/updater/rune_updater.rs`. Runs over the
// in-memory `RuneState` (../runes/state.ts) instead of redb tables; a whole
// block's worth of burns is accumulated in `blockBurned` and only folded into
// each rune's `entry.burned` at the end of the block (`applyBlock`'s final
// step) — matching ord's split between `index_runes` (per tx, accumulates
// into `RuneUpdater.burned`) and `update` (once per block, flushes into
// `RuneEntry.burned`).
//
// NOT ported: the `inscription_id_to_sequence_number` -> `sequence_number_to_rune_id`
// link at the end of `create_rune_entry`. It joins a rune's etching to an
// already-indexed inscription for combined rune+inscription display; this
// spike indexes Runes only (inscriptions are out of scope per the plan), so
// there is no inscription index to join against.

import type { ParsedTx } from "../block.ts";
import type { BitcoinRpcClient } from "../rpc.ts";
import { type Artifact, artifactMint } from "./artifact.ts";
import { type RuneEntry, runeEntryMintable } from "./entry.ts";
import { type Rune, runeIsReserved, runeReserved } from "./rune.ts";
import { type RuneId, runeIdCompare, runeIdToString } from "./rune_id.ts";
import { runestoneDecipher, scriptInstructions } from "./runestone.ts";
import {
	type RuneState,
	getBalance,
	setBalance,
	takeOutpointBalances,
} from "./state.ts";

export interface UpdaterContext {
	height: number;
	blockTime: number;
	/** `Rune::minimum_at_height(Network::Bitcoin, Height(height))`. */
	minimum: Rune;
	rpc: BitcoinRpcClient;
}

const OP_RETURN = 0x6a;

function isOpReturn(script: Uint8Array): boolean {
	return script.length > 0 && script[0] === OP_RETURN;
}

function isP2tr(script: Uint8Array): boolean {
	return script.length === 34 && script[0] === 0x51 && script[1] === 0x20;
}

const TAPROOT_ANNEX_PREFIX = 0x50;

/** `unversioned_leaf_script_from_witness` (`src/lib.rs`) — rust-bitcoin's `Witness::tapscript()`. */
function unversionedLeafScriptFromWitness(
	witness: Uint8Array[],
): Uint8Array | undefined {
	if (witness.length === 0) return undefined;
	const last = witness[witness.length - 1] as Uint8Array;

	let index: number;
	if (
		witness.length >= 2 &&
		last.length > 0 &&
		last[0] === TAPROOT_ANNEX_PREFIX
	) {
		if (witness.length < 3) return undefined;
		index = witness.length - 3;
	} else {
		if (witness.length < 2) return undefined;
		index = witness.length - 2;
	}
	return witness[index];
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** `RuneUpdater::tx_commits_to_rune`. */
async function txCommitsToRune(
	tx: ParsedTx,
	commitRune: Rune,
	ctx: UpdaterContext,
): Promise<boolean> {
	const commitment = runeCommitmentBytes(commitRune);

	for (const input of tx.inputs) {
		const tapscript = unversionedLeafScriptFromWitness(input.witness);
		if (tapscript === undefined) continue;

		for (const instruction of scriptInstructions(tapscript)) {
			// ignore errors, since the extracted script may not be valid
			if (instruction.kind === "error") break;
			if (instruction.kind !== "push") continue;
			if (!bytesEqual(instruction.bytes, commitment)) continue;

			const prevTxInfo = await ctx.rpc.getrawtransaction(input.prevTxid, true);
			const prevOut = prevTxInfo.vout[input.prevVout];
			if (!prevOut) {
				throw new Error(
					`can't get input transaction output: ${input.prevTxid}:${input.prevVout}`,
				);
			}
			const taproot = isP2tr(hexToScript(prevOut.scriptPubKey.hex));
			if (!taproot) continue;

			if (!prevTxInfo.blockhash) {
				// Unconfirmed commit tx can't have reached COMMIT_CONFIRMATIONS.
				continue;
			}
			const header = await ctx.rpc.getblockheader(prevTxInfo.blockhash);
			const commitTxHeight = header.height;

			const confirmations = ctx.height - commitTxHeight + 1;
			if (confirmations >= 6 /* Runestone::COMMIT_CONFIRMATIONS */) {
				return true;
			}
		}
	}

	return false;
}

function hexToScript(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

/** `Rune::commitment` — duplicated here (rather than imported) only to avoid a cyclic import; kept byte-identical to `rune.ts`'s `runeCommitment`. */
function runeCommitmentBytes(self: Rune): Uint8Array {
	const out = new Uint8Array(16);
	let n = self.n;
	for (let i = 0; i < 16; i++) {
		out[i] = Number(n & 0xffn);
		n >>= 8n;
	}
	let end = 16;
	while (end > 0 && out[end - 1] === 0) end -= 1;
	return out.slice(0, end);
}

function runeIdIsDefault(id: RuneId): boolean {
	return id.block === 0n && id.tx === 0n;
}

/** `RuneUpdater::mint`. */
function mint(
	state: RuneState,
	ruleId: string,
	height: bigint,
): bigint | undefined {
	const entry = state.entries.get(ruleId);
	if (!entry) return undefined;

	const result = runeEntryMintable(entry, height);
	if ("err" in result) return undefined;

	entry.mints += 1n;
	state.dirtyRuneIds.add(ruleId);

	return result.ok;
}

/** `RuneUpdater::etched`. */
async function etched(
	state: RuneState,
	txIndex: number,
	tx: ParsedTx,
	artifact: Artifact,
	ctx: UpdaterContext,
): Promise<{ id: RuneId; rune: Rune } | undefined> {
	let candidate: Rune | undefined;
	if (artifact.type === "runestone") {
		if (!artifact.runestone.etching) return undefined;
		candidate = artifact.runestone.etching.rune;
	} else {
		if (!artifact.cenotaph.etching) return undefined;
		candidate = artifact.cenotaph.etching;
	}

	let finalRune: Rune;
	if (candidate !== undefined) {
		if (
			candidate.n < ctx.minimum.n ||
			runeIsReserved(candidate) ||
			state.runeToId.has(candidate.n.toString()) ||
			!(await txCommitsToRune(tx, candidate, ctx))
		) {
			return undefined;
		}
		finalRune = candidate;
	} else {
		state.statisticReservedRunes += 1n;
		finalRune = runeReserved(BigInt(ctx.height), BigInt(txIndex));
	}

	return {
		id: { block: BigInt(ctx.height), tx: BigInt(txIndex) },
		rune: finalRune,
	};
}

/** `RuneUpdater::create_rune_entry`. */
function createRuneEntry(
	state: RuneState,
	txid: string,
	artifact: Artifact,
	id: RuneId,
	etchedRune: Rune,
	ctx: UpdaterContext,
): void {
	const idKey = runeIdToString(id);
	state.runeToId.set(etchedRune.n.toString(), idKey);

	const number = state.statisticRunes;
	state.statisticRunes += 1n;

	let entry: RuneEntry;
	if (artifact.type === "cenotaph") {
		entry = {
			block: id.block,
			burned: 0n,
			divisibility: 0,
			etching: txid,
			mints: 0n,
			number,
			premine: 0n,
			rune: etchedRune.n,
			spacers: 0,
			symbol: undefined,
			terms: undefined,
			timestamp: BigInt(ctx.blockTime),
			turbo: false,
		};
	} else {
		// biome-ignore lint/style/noNonNullAssertion: etched() only returns Some when runestone.etching is Some (mirrors the Rust `.unwrap()`)
		const etching = artifact.runestone.etching!;
		entry = {
			block: id.block,
			burned: 0n,
			divisibility: etching.divisibility ?? 0,
			etching: txid,
			mints: 0n,
			number,
			premine: etching.premine ?? 0n,
			rune: etchedRune.n,
			spacers: etching.spacers ?? 0,
			symbol: etching.symbol,
			terms: etching.terms,
			timestamp: BigInt(ctx.blockTime),
			turbo: etching.turbo,
		};
	}

	state.entries.set(idKey, entry);
	state.dirtyRuneIds.add(idKey);
	state.events.push({
		kind: "etch",
		height: ctx.height,
		txIndex: 0, // caller doesn't have tx_index here in ord either — RuneEtched carries no tx index field
		txid,
		ruleId: idKey,
	});
}

/** `RuneUpdater::unallocated`. */
function unallocated(state: RuneState, tx: ParsedTx): Map<string, bigint> {
	const result = new Map<string, bigint>();
	for (const input of tx.inputs) {
		const outpoint = `${input.prevTxid}:${input.prevVout}`;
		const held = takeOutpointBalances(state, outpoint);
		for (const [ruleId, amount] of held) {
			result.set(ruleId, (result.get(ruleId) ?? 0n) + amount);
		}
	}
	return result;
}

/**
 * `RuneUpdater::index_runes` — applies one transaction's rune effects.
 * `blockBurned` accumulates burns for the whole block (see module docstring);
 * the caller (`applyBlock`) folds it into `entry.burned` once, after every tx
 * in the block has run, matching ord's `update()`.
 */
export async function applyTransaction(
	state: RuneState,
	tx: ParsedTx,
	txIndex: number,
	ctx: UpdaterContext,
	blockBurned: Map<string, bigint>,
): Promise<void> {
	const artifact = runestoneDecipher(tx);

	const unallocatedBalances = unallocated(state, tx);
	const allocated: Map<string, bigint>[] = tx.outputs.map(() => new Map());

	if (artifact !== undefined) {
		const mintId = artifactMint(artifact);
		if (mintId !== undefined) {
			const mintIdKey = runeIdToString(mintId);
			const amount = mint(state, mintIdKey, BigInt(ctx.height));
			if (amount !== undefined) {
				unallocatedBalances.set(
					mintIdKey,
					(unallocatedBalances.get(mintIdKey) ?? 0n) + amount,
				);
				state.events.push({
					kind: "mint",
					height: ctx.height,
					txIndex,
					txid: tx.txid,
					ruleId: mintIdKey,
					amount,
				});
			}
		}

		const etchedResult = await etched(state, txIndex, tx, artifact, ctx);

		if (artifact.type === "runestone") {
			const runestone = artifact.runestone;

			if (etchedResult !== undefined) {
				const etchedIdKey = runeIdToString(etchedResult.id);
				// biome-ignore lint/style/noNonNullAssertion: etchedResult is only Some when runestone.etching is Some (mirrors the Rust `.unwrap()`)
				const premine = runestone.etching!.premine ?? 0n;
				unallocatedBalances.set(
					etchedIdKey,
					(unallocatedBalances.get(etchedIdKey) ?? 0n) + premine,
				);
			}

			for (const edict of runestone.edicts) {
				let balanceKey: string;
				if (runeIdIsDefault(edict.id)) {
					if (etchedResult === undefined) continue;
					balanceKey = runeIdToString(etchedResult.id);
				} else {
					balanceKey = runeIdToString(edict.id);
				}

				const balance = unallocatedBalances.get(balanceKey);
				if (balance === undefined) continue;

				const allocate = (amount: bigint, output: number) => {
					if (amount > 0n) {
						unallocatedBalances.set(
							balanceKey,
							(unallocatedBalances.get(balanceKey) as bigint) - amount,
						);
						const outMap = allocated[output] as Map<string, bigint>;
						outMap.set(balanceKey, (outMap.get(balanceKey) ?? 0n) + amount);
					}
				};

				if (edict.output === tx.outputs.length) {
					// find non-OP_RETURN outputs
					const destinations: number[] = [];
					tx.outputs.forEach((out, i) => {
						if (!isOpReturn(out.script)) destinations.push(i);
					});

					if (destinations.length > 0) {
						if (edict.amount === 0n) {
							const count = BigInt(destinations.length);
							const currentBalance = unallocatedBalances.get(
								balanceKey,
							) as bigint;
							const perOutput = currentBalance / count;
							const remainder = Number(currentBalance % count);
							destinations.forEach((output, i) => {
								allocate(i < remainder ? perOutput + 1n : perOutput, output);
							});
						} else {
							for (const output of destinations) {
								const currentBalance = unallocatedBalances.get(
									balanceKey,
								) as bigint;
								allocate(
									edict.amount < currentBalance ? edict.amount : currentBalance,
									output,
								);
							}
						}
					}
				} else {
					const currentBalance = unallocatedBalances.get(balanceKey) as bigint;
					const amount =
						edict.amount === 0n
							? currentBalance
							: edict.amount < currentBalance
								? edict.amount
								: currentBalance;
					allocate(amount, edict.output);
				}
			}
		}

		if (etchedResult !== undefined) {
			createRuneEntry(
				state,
				tx.txid,
				artifact,
				etchedResult.id,
				etchedResult.rune,
				ctx,
			);
		}
	}

	const burned = new Map<string, bigint>();

	if (artifact?.type === "cenotaph") {
		for (const [ruleId, balance] of unallocatedBalances) {
			burned.set(ruleId, (burned.get(ruleId) ?? 0n) + balance);
		}
	} else {
		const pointer =
			artifact?.type === "runestone" ? artifact.runestone.pointer : undefined;

		let vout: number | undefined;
		if (pointer !== undefined) {
			if (pointer >= allocated.length) {
				throw new Error(
					`runestone pointer ${pointer} out of range for tx ${tx.txid}`,
				);
			}
			vout = pointer;
		} else {
			vout = tx.outputs.findIndex((out) => !isOpReturn(out.script));
			if (vout === -1) vout = undefined;
		}

		if (vout !== undefined) {
			const targetMap = allocated[vout] as Map<string, bigint>;
			for (const [ruleId, balance] of unallocatedBalances) {
				if (balance > 0n) {
					targetMap.set(ruleId, (targetMap.get(ruleId) ?? 0n) + balance);
				}
			}
		} else {
			for (const [ruleId, balance] of unallocatedBalances) {
				if (balance > 0n) {
					burned.set(ruleId, (burned.get(ruleId) ?? 0n) + balance);
				}
			}
		}
	}

	// update outpoint balances
	for (let vout = 0; vout < allocated.length; vout++) {
		const balances = allocated[vout] as Map<string, bigint>;
		if (balances.size === 0) continue;

		const output = tx.outputs[vout];
		if (!output) continue;

		if (isOpReturn(output.script)) {
			for (const [ruleId, balance] of balances) {
				burned.set(ruleId, (burned.get(ruleId) ?? 0n) + balance);
			}
			continue;
		}

		const outpoint = `${tx.txid}:${vout}`;
		const sorted = [...balances.entries()].sort(([a], [b]) =>
			runeIdCompare(runeIdFromKey(a), runeIdFromKey(b)),
		);

		for (const [ruleId, balance] of sorted) {
			setBalance(
				state,
				outpoint,
				ruleId,
				getBalance(state, outpoint, ruleId) + balance,
			);
			state.events.push({
				kind: "transfer",
				height: ctx.height,
				txIndex,
				txid: tx.txid,
				ruleId,
				amount: balance,
				vout,
			});
		}
	}

	// accumulate burns for the block (folded into entry.burned by applyBlock)
	for (const [ruleId, amount] of burned) {
		blockBurned.set(ruleId, (blockBurned.get(ruleId) ?? 0n) + amount);
		state.events.push({
			kind: "burn",
			height: ctx.height,
			txIndex,
			txid: tx.txid,
			ruleId,
			amount,
		});
	}
}

function runeIdFromKey(key: string): RuneId {
	const [block, tx] = key.split(":");
	return { block: BigInt(block as string), tx: BigInt(tx as string) };
}

/**
 * `RuneUpdater::update` — folds a whole block's accumulated burns into each
 * rune's `entry.burned`, once, after every tx in the block has run.
 */
export function applyBlockBurns(
	state: RuneState,
	blockBurned: Map<string, bigint>,
): void {
	for (const [ruleId, amount] of blockBurned) {
		const entry = state.entries.get(ruleId);
		if (!entry) {
			throw new Error(`applyBlockBurns: no entry for rune ${ruleId}`);
		}
		entry.burned += amount;
		state.dirtyRuneIds.add(ruleId);
	}
}
