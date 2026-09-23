// Fetch pool (concurrency FETCH_CONCURRENCY) -> reorder buffer -> sequential
// apply. Not a port of any ord file (ord's `Updater::update_index` does the
// fetch+apply loop against its own node process, in-process — this package
// fetches over RPC from a remote bitcoind instead, per D6/D7).

import type { Kysely } from "kysely";
import { type ParsedBlock, parseBlock } from "./block.ts";
import { type FlushStats, flush, loadState } from "./db/store.ts";
import type { Database } from "./db/types.ts";
import type { BitcoinRpcClient } from "./rpc.ts";
import { checkInvariant } from "./runes/invariant.ts";
import { Network, runeMinimumAtHeight } from "./runes/rune.ts";
import { type RuneState, seedGenesis } from "./runes/state.ts";
import {
	type UpdaterContext,
	applyBlockBurns,
	applyTransaction,
} from "./runes/updater.ts";

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
		stats: FlushStats & {
			hash: string;
			blocksInWindow: number;
			windowMs: number;
		},
	) => void;
	/** Directory to write `invariant-<height>.json` to on a fail-closed invariant break. Defaults to cwd. */
	invariantReportDir?: string;
}

/** Fetches raw blocks `from..to` at `concurrency`, yielding them IN ORDER (a small reorder buffer holds out-of-order completions). */
async function* fetchBlocksInOrder(
	rpc: BitcoinRpcClient,
	from: number,
	to: number,
	concurrency: number,
): AsyncGenerator<{ height: number; block: ParsedBlock }> {
	const total = to - from + 1;
	if (total <= 0) return;

	const results = new Map<number, ParsedBlock>();
	let nextToFetch = from;
	let nextToYield = from;

	async function fetchOne(height: number): Promise<void> {
		const hash = await rpc.getblockhash(height);
		const hex = await rpc.getblock(hash);
		results.set(height, parseBlock(hex));
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
		const block = results.get(nextToYield) as ParsedBlock;
		results.delete(nextToYield);
		yield { height: nextToYield, block };
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

	for await (const { height, block } of fetchBlocksInOrder(
		options.rpc,
		fromHeight,
		options.toHeight,
		options.fetchConcurrency,
	)) {
		checkContinuity(height, block, previousHash);

		const minimum = runeMinimumAtHeight(Network.Bitcoin, height);
		const ctx: UpdaterContext = {
			height,
			blockTime: block.time,
			minimum,
			rpc: options.rpc,
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
				hash: block.hash,
				blocksInWindow,
				windowMs,
			});
			pendingBlocks = [];
			sinceFlush = 0;
			windowStart = performance.now();
		}
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
