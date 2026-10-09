/**
 * Recompute a state-level subgraph from proven inputs.
 *
 *   checkpoint ─▶ header N ─▶ witness root ─▶ named diff (state_writes) ─▶ events ─┐
 *                          └▶ tx merkle root ─▶ txs (ctx.tx) ───────────────────────┤
 *   served handler_code ─▶ pin preimage ─▶ deterministic realm ─▶ memory store ◀────┘
 *
 * Every block in the range is verified with `@secondlayer/verify` from the
 * checkpoint, its named writes become the same events the server feeds the
 * handlers (`stateWriteEvents`), and the bundled handler runs in the
 * deterministic realm against an in-memory store. The result is the table
 * state at `to`; `compareRows` checks it against the served rows.
 */
import { createHash } from "node:crypto";
import { decodeRawTx } from "@secondlayer/shared/node/tx-summary";
import {
	type BlockVerification,
	BlockVerifier,
	type Bytes,
	MAINNET_CHECKPOINT,
	type ProofSource,
	type VerifyCheckpoint,
	type VerifyStep,
	hex,
} from "@secondlayer/verify";
import { applyBlock } from "../runtime/apply-block.ts";
import type { BlockMeta, TxMeta } from "../runtime/context.ts";
import { MemoryStore, MemorySubgraphContext } from "../runtime/memory-store.ts";
import { abortsBlock, loadDeterministicDefinition } from "../runtime/realm.ts";
import type { TxRecord } from "../runtime/source-matcher.ts";
import { stateWriteEvents } from "../runtime/state-writes.ts";
import { generateSubgraphSQL } from "../schema/generator.ts";
import type { SubgraphDefinition, SubgraphFilter } from "../types.ts";
import {
	type PinFields,
	SUBGRAPHS_RUNTIME,
	deriveVerification,
} from "../verification.ts";

export type ReplayStep =
	| "pin"
	| "blocks"
	| "txs"
	| "inputs"
	| "handlers"
	| "rows";

export interface ReplayFailure {
	step: ReplayStep;
	message: string;
	height?: number;
	table?: string;
	key?: Record<string, unknown>;
	/** The source could not serve the input: unchecked, not disproven. */
	unavailable?: boolean;
}

export interface ReplayResult {
	ok: boolean;
	/** Set when the range starts after startBlock and a handler read or merged earlier rows. */
	inconclusive?: string;
	from: number;
	to: number;
	blocks: number;
	txs: number;
	/** Named writes to the subgraph's contracts. */
	writes: number;
	/** Events offered to a handler. */
	events: number;
	handlerErrors: number;
	/** MARF proofs the walk took (one per window top below the checkpoint). */
	marfProofs: number;
	/** The memory store at `to`. */
	tables: Map<string, Record<string, unknown>[]>;
	notes: string[];
	/** The first entry is the first broken link. */
	failures: ReplayFailure[];
}

export interface ReplayOptions {
	/** Needs `getStateWrites`: the names are what feed the handlers. */
	source: ProofSource;
	/** The bundled ESM as stored in `handler_code`. */
	handlerCode: string;
	from: number;
	to: number;
	/** Defaults to `MAINNET_CHECKPOINT`. */
	checkpoint?: VerifyCheckpoint;
	/** Defaults to the definition's `startBlock`. */
	startBlock?: number;
	onProgress?: (height: number) => void;
}

/** Verify blocks 512 at a time: the top by one MARF jump, the rest by parent links. */
export const REPLAY_WINDOW = 512;

/** What verifyBlock says, mapped onto replay links. */
const STEP_OF: Partial<Record<VerifyStep, ReplayStep>> = {
	ancestry: "blocks",
	block: "blocks",
	bitcoin: "blocks",
	burn: "blocks",
	"signer-set": "blocks",
	signatures: "blocks",
	witness: "blocks",
	txs: "txs",
	names: "inputs",
};

const EMPTY_TX: TxMeta = { txId: "", sender: "", type: "", status: "" };

/**
 * The contracts a state subgraph's writes come from, or an error when a
 * source does not fix one: completeness would need every contract's writes.
 */
export function replayContracts(
	def: Pick<SubgraphDefinition, "sources">,
): string[] | { error: string } {
	const out = new Set<string>();
	for (const [name, source] of Object.entries(def.sources)) {
		const f = source as SubgraphFilter & {
			contractId?: string | readonly string[];
			factory?: unknown;
		};
		const ids = Array.isArray(f.contractId)
			? f.contractId
			: f.contractId
				? [f.contractId as string]
				: [];
		if (f.factory || ids.length === 0 || ids.some((id) => id.includes("*")))
			return {
				error: `source "${name}": wildcard contract ids need a full-block name check per contract`,
			};
		for (const id of ids) out.add(id);
	}
	return [...out];
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type PinCheck =
	| { status: "ok"; notes: string[] }
	| { status: "unchecked"; notes: string[] }
	| { status: "failed"; failure: ReplayFailure; notes: string[] };

/**
 * The served pin against the served bundle: the preimage must hash to the
 * pin, and name this handler code, this schema and this startBlock. A runtime
 * other than this package's is a note: rows can still match.
 */
export function checkPin(
	served: {
		pin: string | null;
		pinPreimage: string | null;
		handlerCode: string;
	},
	def: SubgraphDefinition,
): PinCheck {
	if (!served.pin || !served.pinPreimage)
		return { status: "unchecked", notes: [] };
	const failed = (message: string): PinCheck => ({
		status: "failed",
		failure: { step: "pin", message },
		notes: [],
	});
	if (sha256(served.pinPreimage) !== served.pin)
		return failed(`pin ${served.pin} is not the sha256 of its preimage`);
	let fields: PinFields;
	try {
		fields = JSON.parse(served.pinPreimage) as PinFields;
	} catch {
		return failed("pin preimage is not JSON");
	}
	if (fields.handlerHash !== sha256(served.handlerCode))
		return failed("the served handler code is not the bundle the pin names");
	const schemaHash = generateSubgraphSQL(def).hash;
	if (fields.schemaHash !== schemaHash)
		return failed(
			`the pin names schema ${fields.schemaHash}, the served bundle defines ${schemaHash}`,
		);
	if (fields.startBlock !== (def.startBlock ?? null))
		return failed(
			`the pin names startBlock ${fields.startBlock}, the served bundle ${def.startBlock ?? null}`,
		);
	const notes: string[] = [];
	if (fields.runtime !== SUBGRAPHS_RUNTIME)
		notes.push(
			`deployed on ${fields.runtime}, replayed on ${SUBGRAPHS_RUNTIME}`,
		);
	if (fields.network !== "mainnet")
		notes.push(`pinned to network ${fields.network}`);
	return { status: "ok", notes };
}

/** One verified block, reduced to what the handlers need. */
interface ProvenBlock {
	meta: BlockMeta;
	txs: TxRecord[];
	writes: NonNullable<BlockVerification["writes"]>;
}

/** Seams for tests: the block verifier and the burn height hint. */
export interface ReplayDeps {
	verify(height: number): Promise<BlockVerification>;
	/** The source's (unproven) burn height for a consensus hash. */
	burnHeightHint(consensusHash: string): Promise<number>;
}

function decodeTxs(v: BlockVerification): TxRecord[] {
	return (v.transactions ?? []).map((t, i): TxRecord => {
		const d = decodeRawTx(hex(t.raw), t.txid);
		return {
			tx_id: `0x${t.txid}`,
			tx_index: i,
			type: d?.txType ?? "unknown",
			sender: d?.sender ?? "unknown",
			// A failed transaction's contract writes roll back, so every tx a
			// named write hangs on succeeded.
			status: "success",
			contract_id: d?.contractId ?? null,
			function_name: d?.functionName ?? null,
			function_args: d?.functionArgs ?? null,
			raw_result: null,
		};
	});
}

/** The replay loop over an injected verifier. */
export async function replayBlocks(
	deps: ReplayDeps,
	opts: Omit<ReplayOptions, "source" | "checkpoint"> & {
		bitcoinCheckpoint?: number;
	},
): Promise<ReplayResult> {
	const out: ReplayResult = {
		ok: false,
		from: opts.from,
		to: opts.to,
		blocks: 0,
		txs: 0,
		writes: 0,
		events: 0,
		handlerErrors: 0,
		marfProofs: 0,
		tables: new Map(),
		notes: [],
		failures: [],
	};
	const done = () => {
		out.ok = out.failures.length === 0 && !out.inconclusive;
		return out;
	};

	let def: SubgraphDefinition;
	try {
		def = await loadDeterministicDefinition(opts.handlerCode);
	} catch (err) {
		out.failures.push({
			step: "handlers",
			message: `the bundle does not load in the deterministic realm: ${(err as Error).message}`,
		});
		return done();
	}
	const level = deriveVerification(def);
	if (level.level !== "state") {
		out.failures.push({
			step: "handlers",
			message: `level ${level.level}, not state: ${level.reasons.join("; ")}`,
		});
		return done();
	}
	const contracts = replayContracts(def);
	if (!Array.isArray(contracts)) {
		out.failures.push({ step: "inputs", message: contracts.error });
		return done();
	}
	const ours = (key: string) =>
		contracts.some((c) => key.startsWith(`vm::${c}::`));
	const startBlock = opts.startBlock ?? def.startBlock ?? 0;
	const midHistory = opts.from > startBlock;
	const store = new MemoryStore();
	const burnHints = new Map<string, number>();
	let notedBurn = false;

	for (let a = opts.from; a <= opts.to; a += REPLAY_WINDOW) {
		const b = Math.min(a + REPLAY_WINDOW - 1, opts.to);
		// Top first, then down: each lower block is one parent link from a
		// block just proven, so only the top costs a MARF proof.
		const proven = new Map<number, ProvenBlock>();
		for (let h = b; h >= a; h--) {
			const v = await deps.verify(h);
			const first = v.failures[0];
			if (first) {
				out.failures.push({
					step: STEP_OF[first.step] ?? "blocks",
					message: `block ${h}: ${first.message}`,
					height: h,
					...(first.code === "unavailable" ? { unavailable: true } : {}),
				});
				return done();
			}
			if (v.ancestry?.via === "marf") out.marfProofs++;
			if (!v.blockHash || !v.blockId) {
				out.failures.push({
					step: "blocks",
					message: `block ${h}: epoch 2.x; replay needs Nakamoto blocks`,
					height: h,
					unavailable: true,
				});
				return done();
			}
			if (!v.transactions) {
				out.failures.push({
					step: "txs",
					message: `block ${h}: the source served no transactions`,
					height: h,
					unavailable: true,
				});
				return done();
			}
			if (!v.diff?.named || !v.writes) {
				out.failures.push({
					step: "inputs",
					message: `block ${h}: the source has no state_writes for it, so its writes cannot be named`,
					height: h,
					unavailable: true,
				});
				return done();
			}
			let burnHeight = v.burnHeight;
			if (burnHeight === undefined) {
				const ch = v.consensusHash as string;
				burnHeight = burnHints.get(ch);
				if (burnHeight === undefined) {
					burnHeight = await deps.burnHeightHint(ch);
					burnHints.set(ch, burnHeight);
				}
				if (!notedBurn) {
					out.notes.push(
						`burn height unproven below Bitcoin ${opts.bitcoinCheckpoint ?? "checkpoint"}: ctx.block.burnBlockHeight is the source's claim`,
					);
					notedBurn = true;
				}
			}
			proven.set(h, {
				meta: {
					height: h,
					hash: `0x${v.blockHash}`,
					timestamp: v.timestamp ?? 0,
					burnBlockHeight: burnHeight,
					indexBlockHash: `0x${v.blockId}`,
				},
				txs: decodeTxs(v),
				writes: v.writes.filter((w) => ours(w.key)),
			});
		}

		for (let h = a; h <= b; h++) {
			const block = proven.get(h) as ProvenBlock;
			const byIndex = new Map(block.txs.map((t) => [t.tx_index as number, t]));
			let fed: ReturnType<typeof stateWriteEvents>;
			try {
				fed = stateWriteEvents(block.writes, byIndex);
			} catch (err) {
				out.failures.push({
					step: "inputs",
					message: `block ${h}: ${(err as Error).message}`,
					height: h,
				});
				return done();
			}
			const ctx = new MemorySubgraphContext(
				store,
				def.schema,
				block.meta,
				EMPTY_TX,
			);
			try {
				const r = await applyBlock(
					def,
					{ txs: fed.txs, events: [], vmEvents: fed.vmEvents },
					ctx,
				);
				out.events += r.delivered;
				out.handlerErrors += r.errors;
			} catch (err) {
				if (!abortsBlock(err)) throw err;
				out.failures.push({
					step: "handlers",
					message: `block ${h} ${(err as Error).name}: ${(err as Error).message}`,
					height: h,
				});
				return done();
			}
			await ctx.commitOps();
			if (midHistory && ctx.readDependent && !out.inconclusive) {
				out.inconclusive = `block ${h}: ${ctx.readDependent} depends on rows written before ${opts.from}; replay from startBlock ${startBlock}`;
			}
			out.blocks++;
			out.txs += block.txs.length;
			out.writes += block.writes.length;
			opts.onProgress?.(h);
		}
	}
	out.tables = store.tables;
	return done();
}

/** Keep the last two witnesses: walking down, block h's parent witness is the next fetch. */
function cacheWitnesses(source: ProofSource): ProofSource {
	const recent = new Map<string, Promise<Bytes>>();
	const out: ProofSource = {
		getBlock: (ref) => source.getBlock(ref),
		getMarfProof: (path, tip) => source.getMarfProof(path, tip),
		getBurnPreimage: (ch) => source.getBurnPreimage(ch),
		getBitcoinHeaders: (from, count) => source.getBitcoinHeaders(from, count),
		getWitness: (id) => {
			let w = recent.get(id);
			if (!w) {
				w = source.getWitness(id);
				// A failed fetch is not cached; the caller still sees the error.
				w.catch(() => recent.delete(id));
				recent.set(id, w);
				while (recent.size > 2)
					recent.delete(recent.keys().next().value as string);
			}
			return w;
		},
	};
	const { getEpoch2Header, getStateWrites } = source;
	if (getEpoch2Header)
		out.getEpoch2Header = (id) => getEpoch2Header.call(source, id);
	if (getStateWrites)
		out.getStateWrites = (height) => getStateWrites.call(source, height);
	return out;
}

/** Verify every block in `[from, to]` from the checkpoint and recompute the subgraph's tables. */
export async function replaySubgraph(
	opts: ReplayOptions,
): Promise<ReplayResult> {
	const checkpoint = opts.checkpoint ?? MAINNET_CHECKPOINT;
	const source = cacheWitnesses(opts.source);
	const verifier = new BlockVerifier({ source, checkpoint });
	return replayBlocks(
		{
			verify: (h) => verifier.verify(h),
			burnHeightHint: async (ch) =>
				(await source.getBurnPreimage(ch)).burnHeight,
		},
		{ ...opts, bitcoinCheckpoint: checkpoint.bitcoin.height },
	);
}
