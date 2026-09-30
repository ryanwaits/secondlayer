// Fetch pool (concurrency FETCH_CONCURRENCY) -> reorder buffer -> sequential
// apply. Not a port of any ord file (ord's `Updater::update_index` does the
// fetch+apply loop against its own node process, in-process — this package
// fetches over RPC from a remote bitcoind instead, per D6/D7).

import type { Kysely } from "kysely";
import { type ParsedBlock, parseBlock } from "./block.ts";
import {
	DEFER_INDEX_THRESHOLD,
	dropReadIndexes,
	ensureReadIndexes,
} from "./db/read-indexes.ts";
import {
	type FlushBlock,
	type FlushStats,
	flush,
	loadState,
} from "./db/store.ts";
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
	network: Network = Network.Bitcoin,
): Promise<CommitmentMap> {
	const minimum = runeMinimumAtHeight(network, height);
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
// 1000 OOMs at 22g at current chain height (plan 083); 250 plus `--smol`
// peaked at 17.1 GiB on the same run — the only measured-safe default.
export const DEFAULT_FLUSH_INTERVAL = 250;

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
	/** Defaults to `Network.Bitcoin` (mainnet). Only ever overridden by the regtest reorg test (`test/regtest/`) — Runes activates at block 0 on regtest, not 840,000, and there's no mainnet-only UNCOMMON•GOODS to seed. */
	network?: Network;
	/** Defaults to `GENESIS_HEIGHT` (840,000, mainnet's Runes activation height). Regtest-test-only override — see `network`. */
	genesisHeight?: number;
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
	/** Test-only override for `DEFER_INDEX_THRESHOLD` (`db/read-indexes.ts`) — production never sets this. */
	deferIndexThreshold?: number;
	/**
	 * Continue from a state the caller already holds (`follow`'s catch-up)
	 * instead of loading a second copy from Postgres. It must be the state as of
	 * the last flush (nothing dirty) and already seeded (`seedGenesis`) when
	 * fresh. Mutated in place and returned. If this run throws, it may be ahead
	 * of the database: discard it. Omitted, the run loads (and seeds) its own.
	 */
	state?: RuneState;
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
 *
 * Every launched fetch's outcome (success into `results`, failure into
 * `errors`) is recorded via a handler attached at launch time — before the
 * consumer ever awaits anything — so a rejection is never lost even if it
 * lands while the consumer is busy applying a previously yielded block (plan
 * 076: `.finally(() => inFlight.delete(p))` alone let a fetch's rejection
 * vanish unobserved once nothing else referenced that promise, so once every
 * other fetch drained, `Promise.race(inFlight)` on an empty set never
 * settled and the whole process idled with nothing left to run the event
 * loop — mid-run, backfill exited 0 short of its target).
 */
export async function* fetchBlocksInOrder(
	rpc: BitcoinRpcClient,
	from: number,
	to: number,
	concurrency: number,
	network: Network,
): AsyncGenerator<{ height: number; fetched: FetchedBlock }> {
	const total = to - from + 1;
	if (total <= 0) return;

	const results = new Map<number, FetchedBlock>();
	const errors = new Map<number, unknown>();
	let nextToFetch = from;
	let nextToYield = from;

	async function fetchOne(height: number): Promise<void> {
		const hash = await rpc.getblockhash(height);
		const hex = await rpc.getblock(hash);
		const block = parseBlock(hex);
		const commitments = await resolveBlockCommitments(
			rpc,
			block,
			height,
			network,
		);
		results.set(height, { block, commitments });
	}

	const inFlight = new Set<Promise<void>>();

	function launchNext(): void {
		if (nextToFetch > to) return;
		const height = nextToFetch;
		nextToFetch += 1;
		const p = fetchOne(height)
			.catch((error) => {
				errors.set(height, error);
			})
			.finally(() => inFlight.delete(p));
		inFlight.add(p);
	}

	for (let i = 0; i < concurrency && nextToFetch <= to; i++) launchNext();

	while (nextToYield <= to) {
		if (errors.has(nextToYield)) {
			const error = errors.get(nextToYield);
			errors.delete(nextToYield);
			throw error;
		}
		if (!results.has(nextToYield)) {
			if (inFlight.size === 0) {
				throw new Error(
					`fetchBlocksInOrder: no result or error for height ${nextToYield} and nothing in flight (invariant violated)`,
				);
			}
			await Promise.race(inFlight);
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
	const network = options.network ?? Network.Bitcoin;
	const genesisHeight = options.genesisHeight ?? GENESIS_HEIGHT;

	let state = options.state;
	if (state === undefined) {
		state = await loadState(options.db);
		if (state.height === undefined && network === Network.Bitcoin) {
			// UNCOMMON•GOODS is a mainnet-only pre-existing rune (`seedGenesis`'s own
			// docstring) — regtest/testnet/signet have no equivalent to seed.
			seedGenesis(state);
		}
	}

	const fromHeight = (state.height ?? genesisHeight - 1) + 1;
	if (fromHeight > options.toHeight) {
		return state;
	}

	// Large gap (plan 089): the two big `rune_events` read indexes only serve
	// `/v1/index/runes` reads, never ingest — drop them before the bulk load
	// and rebuild once at the end, instead of maintaining them live against a
	// growing table on every flush. A small gap (tip catch-up) leaves them
	// alone entirely.
	const deferIndexThreshold =
		options.deferIndexThreshold ?? DEFER_INDEX_THRESHOLD;
	const deferIndexes = options.toHeight - fromHeight > deferIndexThreshold;
	if (deferIndexes) {
		await dropReadIndexes(options.db);
	}

	let previousHash = state.height === undefined ? undefined : state.hash;
	let pendingBlocks: FlushBlock[] = [];
	let sinceFlush = 0;
	let windowStart = performance.now();
	let timers = createFlushPhaseTimers();
	let fetchWaitStart = performance.now();

	for await (const { height, fetched } of fetchBlocksInOrder(
		options.rpc,
		fromHeight,
		options.toHeight,
		options.fetchConcurrency,
		network,
	)) {
		const { block, commitments } = fetched;
		timers.fetchWaitMs += performance.now() - fetchWaitStart;

		const integrityStart = performance.now();
		verifyBlockIntegrity(block);
		timers.integrityMs += performance.now() - integrityStart;

		checkContinuity(height, block, previousHash);

		const minimum = runeMinimumAtHeight(network, height);
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
		pendingBlocks.push({ height, hash: block.hash, time: block.time });
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

	if (deferIndexes) {
		await ensureReadIndexes(options.db);
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
