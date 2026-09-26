// Fetch pool (concurrency FETCH_CONCURRENCY) -> reorder buffer -> sequential
// apply. Not a port of any ord file (ord's `Updater::update_index` does the
// fetch+apply loop against its own node process, in-process — this package
// fetches over RPC from a remote bitcoind instead, per D6/D7).

import type { Kysely } from "kysely";
import { type ParsedBlock, parseBlock } from "./block.ts";
import { type FlushStats, flush, loadState } from "./db/store.ts";
import type { Database } from "./db/types.ts";
import { verifyBlockIntegrity } from "./integrity/merkle.ts";
import type {
	BitcoinRpcClient,
	BlockHeader,
	RawTransactionVerbose,
} from "./rpc.ts";
import { checkInvariant } from "./runes/invariant.ts";
import { Network, runeIsReserved, runeMinimumAtHeight } from "./runes/rune.ts";
import { runestoneDecipher } from "./runes/runestone.ts";
import { type RuneState, seedGenesis } from "./runes/state.ts";
import {
	type CommitmentMap,
	type FlushPhaseTimers,
	type UpdaterContext,
	applyBlockBurns,
	applyTransaction,
	candidateCommitmentInputs,
	createFlushPhaseTimers,
	hexToScript,
	isP2tr,
} from "./runes/updater.ts";

/** `Runestone::COMMIT_CONFIRMATIONS` — mirrors the constant `runes/updater.ts`'s (removed) inline check used. */
const COMMIT_CONFIRMATIONS = 6;

/**
 * Bounds total concurrent commitment-resolution RPC calls across every
 * in-flight block fetch. Without this, `FETCH_CONCURRENCY` blocks fetching in
 * parallel, each fanning out one RPC pair per candidate commitment input,
 * spikes to hundreds of simultaneous requests — measured live against
 * node-server bitcoind as an HTTP 503 (its RPC work queue overflowing) that
 * crashed the backfill outright. A module-wide semaphore (shared across every
 * `resolveBlockCommitments` call, not one per block) keeps the real
 * concurrency bounded regardless of how many blocks are in flight.
 */
class Semaphore {
	private available: number;
	private readonly waiters: Array<() => void> = [];

	constructor(limit: number) {
		this.available = limit;
	}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.available <= 0) {
			await new Promise<void>((resolve) => {
				this.waiters.push(resolve);
			});
		}
		this.available -= 1;
		try {
			return await fn();
		} finally {
			this.available += 1;
			const next = this.waiters.shift();
			if (next) next();
		}
	}
}

const commitmentRpcLimit = new Semaphore(
	Number(process.env.COMMIT_RPC_CONCURRENCY ?? "8"),
);

/**
 * Resolves, in parallel, every candidate commitment input in `block` — "is
 * `prevTxid:prevVout` a taproot output confirmed `>= COMMIT_CONFIRMATIONS`
 * blocks before `height`?" — ahead of the sequential apply loop (plan 039
 * step 5). This is the RPC-bound half of ord's `tx_commits_to_rune`,
 * factored out because it is a pure function of chain data + `height`: the
 * only thing that can gate whether a candidate even needs checking that
 * ISN'T available yet at fetch time is `state.runeToId` (it only exists,
 * and keeps changing, in the sequential apply loop) — so this deliberately
 * runs the same minimum/reserved pre-checks `etched()` does, but never the
 * `runeToId` one. Skipping that check here only ever produces an unused
 * (never consulted) extra resolution, never a missing one, since the apply
 * loop's `etched()` short-circuits on `runeToId` before ever consulting the
 * map, exactly as it did before this change existed.
 */
/** Exported for `follow.ts`'s near-tip one-block-at-a-time apply loop, which needs the same commitment resolution this uses per block during backfill. */
export async function resolveBlockCommitments(
	rpc: BitcoinRpcClient,
	block: ParsedBlock,
	height: number,
): Promise<CommitmentMap> {
	const minimum = runeMinimumAtHeight(Network.Bitcoin, height);
	const resolved = new Map<string, boolean>();
	const seen = new Set<string>();
	const txCache = new Map<string, Promise<RawTransactionVerbose>>();
	const headerCache = new Map<string, Promise<BlockHeader>>();
	const pending: Promise<void>[] = [];

	function getTx(prevTxid: string): Promise<RawTransactionVerbose> {
		let p = txCache.get(prevTxid);
		if (!p) {
			p = commitmentRpcLimit.run(() => rpc.getrawtransaction(prevTxid, true));
			txCache.set(prevTxid, p);
		}
		return p;
	}
	function getHeader(blockhash: string): Promise<BlockHeader> {
		let p = headerCache.get(blockhash);
		if (!p) {
			p = commitmentRpcLimit.run(() => rpc.getblockheader(blockhash));
			headerCache.set(blockhash, p);
		}
		return p;
	}

	for (const tx of block.txs) {
		const artifact = runestoneDecipher(tx);
		if (artifact === undefined) continue;
		const candidate =
			artifact.type === "runestone"
				? artifact.runestone.etching?.rune
				: artifact.cenotaph.etching;
		if (candidate === undefined) continue;
		if (candidate.n < minimum.n || runeIsReserved(candidate)) continue;

		for (const { prevTxid, prevVout } of candidateCommitmentInputs(
			tx,
			candidate,
		)) {
			const key = `${prevTxid}:${prevVout}`;
			if (seen.has(key)) continue;
			seen.add(key);

			pending.push(
				(async () => {
					const prevTxInfo = await getTx(prevTxid);
					const prevOut = prevTxInfo.vout[prevVout];
					if (!prevOut) {
						throw new Error(
							`can't get input transaction output: ${prevTxid}:${prevVout}`,
						);
					}
					if (!isP2tr(hexToScript(prevOut.scriptPubKey.hex))) {
						resolved.set(key, false);
						return;
					}
					if (!prevTxInfo.blockhash) {
						// Unconfirmed commit tx can't have reached COMMIT_CONFIRMATIONS.
						resolved.set(key, false);
						return;
					}
					const header = await getHeader(prevTxInfo.blockhash);
					const confirmations = height - header.height + 1;
					resolved.set(key, confirmations >= COMMIT_CONFIRMATIONS);
				})(),
			);
		}
	}

	await Promise.all(pending);

	return {
		isConfirmedTaprootCommit: (prevTxid, prevVout) =>
			resolved.get(`${prevTxid}:${prevVout}`) ?? false,
	};
}

export const GENESIS_HEIGHT = 840_000;
export const DEFAULT_FLUSH_INTERVAL = 1_000;

export class ContinuityError extends Error {
	constructor(
		readonly height: number,
		readonly expectedPrevHash: string,
		readonly actualPrevHash: string,
	) {
		super(
			`continuity break at height ${height}: expected prevHash ${expectedPrevHash}, block has ${actualPrevHash}`,
		);
		this.name = "ContinuityError";
	}
}

/**
 * `prevHash(H) == hash(H-1)` — the plan's fail-closed reorg check (deep reorg
 * handling is Phase 2 / D10; this only catches a break, it doesn't undo one).
 * `previousHash` is `undefined` only at the very first block ever applied
 * (genesis height, fresh state).
 */
export function checkContinuity(
	height: number,
	block: Pick<ParsedBlock, "prevHash">,
	previousHash: string | undefined,
): void {
	if (previousHash === undefined) return;
	if (block.prevHash !== previousHash) {
		throw new ContinuityError(height, previousHash, block.prevHash);
	}
}

export class InvariantFlushError extends Error {
	constructor(
		readonly height: number,
		readonly cause: unknown,
	) {
		super(
			`invariant check failed while flushing at height ${height}: ${String(cause)}`,
		);
		this.name = "InvariantFlushError";
	}
}

export interface BackfillOptions {
	db: Kysely<Database>;
	rpc: BitcoinRpcClient;
	toHeight: number;
	fetchConcurrency: number;
	flushInterval?: number;
	/** Called after every flush with row-count/timing stats plus how many blocks were in this window and the wall-clock ms since the previous flush (for a blocks/s log line). */
	onFlush?: (
		stats: FlushStats &
			FlushPhaseTimers & {
				hash: string;
				blocksInWindow: number;
				windowMs: number;
			},
	) => void;
	/** Directory to write `invariant-<height>.json` to on a fail-closed invariant break. Defaults to cwd. */
	invariantReportDir?: string;
}

interface FetchedBlock {
	block: ParsedBlock;
	commitments: CommitmentMap;
}

/**
 * Fetches raw blocks `from..to` at `concurrency`, yielding them IN ORDER (a
 * small reorder buffer holds out-of-order completions). Each fetch also
 * resolves that block's commitment RPCs in parallel (plan 039 step 5) before
 * the block is yielded, so the sequential apply loop never awaits an RPC.
 */
async function* fetchBlocksInOrder(
	rpc: BitcoinRpcClient,
	from: number,
	to: number,
	concurrency: number,
): AsyncGenerator<{ height: number; fetched: FetchedBlock }> {
	const total = to - from + 1;
	if (total <= 0) return;

	const results = new Map<number, FetchedBlock>();
	let nextToFetch = from;
	let nextToYield = from;

	async function fetchOne(height: number): Promise<void> {
		const hash = await rpc.getblockhash(height);
		const hex = await rpc.getblock(hash);
		const block = parseBlock(hex);
		const commitments = await resolveBlockCommitments(rpc, block, height);
		results.set(height, { block, commitments });
	}

	const inFlight = new Set<Promise<void>>();

	function launchNext(): void {
		if (nextToFetch > to) return;
		const height = nextToFetch;
		nextToFetch += 1;
		const p = fetchOne(height).finally(() => inFlight.delete(p));
		inFlight.add(p);
	}

	for (let i = 0; i < concurrency && nextToFetch <= to; i++) launchNext();

	while (nextToYield <= to) {
		if (!results.has(nextToYield)) {
			// biome-ignore lint/style/noNonNullAssertion: inFlight is non-empty whenever nextToYield hasn't been fetched yet (loop invariant)
			await Promise.race(inFlight)!;
			continue;
		}
		const fetched = results.get(nextToYield) as FetchedBlock;
		results.delete(nextToYield);
		yield { height: nextToYield, fetched };
		nextToYield += 1;
		launchNext();
	}
}

/** Runs the backfill from the resumed checkpoint (or 840,000 on a fresh state) through `options.toHeight`, inclusive. */
export async function runBackfill(
	options: BackfillOptions,
): Promise<RuneState> {
	const flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;

	const state = await loadState(options.db);
	if (state.height === undefined) {
		seedGenesis(state);
	}

	const fromHeight = (state.height ?? GENESIS_HEIGHT - 1) + 1;
	if (fromHeight > options.toHeight) {
		return state;
	}

	let previousHash = state.height === undefined ? undefined : state.hash;
	let pendingBlocks: Array<{ height: number; hash: string }> = [];
	let sinceFlush = 0;
	let windowStart = performance.now();
	let timers = createFlushPhaseTimers();
	let fetchWaitStart = performance.now();

	for await (const { height, fetched } of fetchBlocksInOrder(
		options.rpc,
		fromHeight,
		options.toHeight,
		options.fetchConcurrency,
	)) {
		const { block, commitments } = fetched;
		timers.fetchWaitMs += performance.now() - fetchWaitStart;

		const integrityStart = performance.now();
		verifyBlockIntegrity(block);
		timers.integrityMs += performance.now() - integrityStart;

		checkContinuity(height, block, previousHash);

		const minimum = runeMinimumAtHeight(Network.Bitcoin, height);
		const ctx: UpdaterContext = {
			height,
			blockTime: block.time,
			minimum,
			commitments,
			timers,
		};

		const blockBurned = new Map<string, bigint>();
		for (const [txIndex, tx] of block.txs.entries()) {
			await applyTransaction(state, tx, txIndex, ctx, blockBurned);
		}
		applyBlockBurns(state, blockBurned);

		previousHash = block.hash;
		pendingBlocks.push({ height, hash: block.hash });
		sinceFlush += 1;

		const isFinal = height === options.toHeight;
		if (sinceFlush >= flushInterval || isFinal) {
			const blocksInWindow = pendingBlocks.length;
			let stats: FlushStats;
			try {
				stats = await flush(options.db, state, pendingBlocks, checkInvariant);
			} catch (error) {
				await writeInvariantReport(options.invariantReportDir, height, error);
				throw error;
			}
			const windowMs = performance.now() - windowStart;
			options.onFlush?.({
				...stats,
				...timers,
				hash: block.hash,
				blocksInWindow,
				windowMs,
			});
			pendingBlocks = [];
			sinceFlush = 0;
			windowStart = performance.now();
			timers = createFlushPhaseTimers();
		}

		fetchWaitStart = performance.now();
	}

	return state;
}

async function writeInvariantReport(
	dir: string | undefined,
	height: number,
	error: unknown,
): Promise<void> {
	const { writeFile } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const path = join(dir ?? process.cwd(), `invariant-${height}.json`);
	const message = error instanceof Error ? error.message : String(error);
	const runeId =
		error && typeof error === "object" && "runeId" in error
			? (error as { runeId: string }).runeId
			: undefined;
	await writeFile(
		path,
		JSON.stringify({ height, message, runeId }, null, 2),
		"utf8",
	);
}
