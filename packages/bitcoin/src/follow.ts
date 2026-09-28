// Follows the Bitcoin tip (plan 057, D12) instead of the one-shot
// `backfill --to <H>` (plan 037/039). Not a port of any ord file — ord
// re-indexes from scratch on any reorg it notices at all; this catches up
// with the existing parallel backfill while far from the tip, then walks one
// block at a time near it, flushing (and writing an undo row for) every
// block individually so a shallow reorg (D10, `UNDO_DEPTH`) can be reversed
// in place instead of forcing a rebuild.
//
// `BlockNotifier` is the wake-up source for "check the tip again" — this
// module never polls for new blocks itself. `RpcWaitNotifier`
// (`./rpc-wait-notifier.ts`, D12 amended 2026-09-26: wakes on bitcoind's
// `waitfornewblock` RPC, not ZMQ) is the real one; `FakeNotifier` in
// `follow.test.ts` drives the unit tests.

import type { Kysely } from "kysely";
import {
	type BackfillOptions,
	ContinuityError,
	GENESIS_HEIGHT,
	checkContinuity,
	resolveBlockCommitments,
	runBackfill,
} from "./backfill.ts";
import { type ParsedBlock, parseBlock } from "./block.ts";
import { ensureReadIndexes } from "./db/read-indexes.ts";
import { type FlushStats, flush, loadState } from "./db/store.ts";
import type { Database } from "./db/types.ts";
import { verifyBlockIntegrity } from "./integrity/merkle.ts";
import { DeepReorgError, rewindTo } from "./rewind.ts";
import type { BitcoinRpcClient } from "./rpc.ts";
import { checkInvariant } from "./runes/invariant.ts";
import { Network, runeMinimumAtHeight } from "./runes/rune.ts";
import { type RuneState, seedGenesis } from "./runes/state.ts";
import { UNDO_DEPTH, snapshotState } from "./runes/undo.ts";
import {
	type UpdaterContext,
	applyBlockBurns,
	applyTransaction,
} from "./runes/updater.ts";

/**
 * Wake-up source for "the tip may have moved, check again" — `runFollow`
 * never polls for blocks itself (D12: push, not polling). `notified()`
 * resolves when bitcoind's blocking `waitfornewblock` RPC returns, whether
 * that's a new block or its own timeout — either way it's just a signal to
 * re-run `syncOnce`, never block data itself.
 */
export interface BlockNotifier {
	/** Resolves the next time a block may have landed (a real notification, or the reconnect-timer safety net). Never rejects. */
	notified(): Promise<void>;
	close(): void;
}

export interface ReorgInfo {
	forkHeight: number;
	oldCheckpointHeight: number;
}

/** `runFollow`'s periodic liveness snapshot — see `onHeartbeat` below. */
export interface HeartbeatInfo {
	checkpointHeight: number | undefined;
	tipHeight: number;
	lag: number;
	/** True once `lag` has stayed above `STALE_LAG_BLOCKS` continuously for more than `STALE_AFTER_MS`. */
	stale: boolean;
}

export interface FollowDeps {
	db: Kysely<Database>;
	rpc: BitcoinRpcClient;
	fetchConcurrency?: number;
	invariantReportDir?: string;
	/** Defaults to `DEFAULT_FLUSH_INTERVAL` (`backfill.ts`) — only affects the batch catch-up (`runBackfill`); the per-block loop near the tip always flushes every block regardless. */
	flushInterval?: number;
	/** Forwarded to the batch catch-up's `runBackfill` call — the per-block loop near the tip doesn't report through this (it flushes every block, not in batches). */
	onFlush?: BackfillOptions["onFlush"];
	onBlock?: (info: { height: number; hash: string }) => void;
	onReorg?: (info: ReorgInfo) => void;
	/**
	 * Called at most once every `HEARTBEAT_INTERVAL_MS` of wall-clock time by
	 * `runFollow` with a checkpoint/tip/lag snapshot (plan 076) — `follow`
	 * otherwise runs forever with no signal at all once it stops making
	 * per-block progress (the original silent-hang bug: no log line, no
	 * crash, just an idle process). `cli.ts` logs this, at error level when
	 * `stale` is true; the Slack wiring for that stays in plan 062.
	 */
	onHeartbeat?: (info: HeartbeatInfo) => void;
	/** Test seam: overrides `Date.now` for the heartbeat's interval/staleness tracking. */
	now?: () => number;
	/** Defaults to `Network.Bitcoin` (mainnet). Only ever overridden by the regtest reorg test (`test/regtest/`) — see `backfill.ts`'s `BackfillOptions.network`. */
	network?: Network;
	/** Defaults to `GENESIS_HEIGHT` (840,000). Regtest-test-only override — see `network`. */
	genesisHeight?: number;
	/**
	 * Caps both the batch catch-up and the per-block loop at this height —
	 * `syncOnce` never fetches or applies a block past it, even when the live
	 * chain's tip is higher. `runFollow` stops cleanly (returns) once the
	 * checkpoint reaches it, instead of waiting on the next notification
	 * (plan 062: `cli.ts follow --until <H>`, used by weekly frozen parity to
	 * pin both sides to the same height before diffing).
	 */
	until?: number;
}

/**
 * Walks back from `state.height` (its own hash still trusted at the start of
 * the search) until the live chain's `getblockhash` at some height matches
 * what we already persisted (`btc_blocks`) at that height — the fork point.
 * Bounded to `UNDO_DEPTH` (D10): a deeper mismatch throws `DeepReorgError`
 * without touching the DB (mirrors `rewindTo`'s own guard, which would throw
 * the same way — checked here too so the search itself doesn't wander deep
 * into history first).
 */
async function findForkHeight(
	deps: FollowDeps,
	fromHeight: number,
): Promise<number> {
	const floor = fromHeight - UNDO_DEPTH;
	for (let height = fromHeight; height >= floor; height--) {
		const dbRow = await deps.db
			.selectFrom("btc_blocks")
			.select("hash")
			.where("height", "=", height)
			.executeTakeFirst();
		if (!dbRow) continue; // below GENESIS_HEIGHT (genesis-seeded, no fetched row) — keep walking to the floor
		const liveHash = await deps.rpc.getblockhash(height);
		if (liveHash === dbRow.hash) return height;
	}
	throw new DeepReorgError(fromHeight, floor - 1);
}

/**
 * Verifies `state`'s checkpoint is still on the live chain's best branch; if
 * not, finds the fork and rewinds. Returns `state` unchanged when there's
 * nothing to reconcile (no checkpoint yet, or the checkpoint still matches) —
 * otherwise returns the freshly `loadState`-d state after the rewind
 * ("simplest correct", per plan design: `rewindTo` mutates its own copy of
 * `state` too, but the caller reloads regardless).
 */
async function reconcileCheckpoint(
	deps: FollowDeps,
	state: RuneState,
): Promise<RuneState> {
	if (state.height === undefined) return state;

	const liveHash = await deps.rpc.getblockhash(state.height);
	if (liveHash === state.hash) return state;

	const oldCheckpointHeight = state.height;
	const forkHeight = await findForkHeight(deps, state.height);
	await rewindTo(deps.db, state, forkHeight);
	deps.onReorg?.({ forkHeight, oldCheckpointHeight });
	return await loadState(deps.db);
}

async function applyOneBlock(
	deps: FollowDeps,
	state: RuneState,
	height: number,
	block: ParsedBlock,
): Promise<FlushStats> {
	verifyBlockIntegrity(block);
	checkContinuity(height, block, state.hash);

	const network = deps.network ?? Network.Bitcoin;
	const commitments = await resolveBlockCommitments(
		deps.rpc,
		block,
		height,
		network,
	);
	const ctx: UpdaterContext = {
		height,
		blockTime: block.time,
		minimum: runeMinimumAtHeight(network, height),
		commitments,
	};

	const before = snapshotState(state);
	const blockBurned = new Map<string, bigint>();
	for (const [txIndex, tx] of block.txs.entries()) {
		await applyTransaction(state, tx, txIndex, ctx, blockBurned);
	}
	applyBlockBurns(state, blockBurned);

	return flush(deps.db, state, [{ height, hash: block.hash }], checkInvariant, {
		undoSnapshotBeforeBlock: before,
	});
}

export interface SyncResult {
	state: RuneState;
	blocksApplied: number;
}

/**
 * One catch-up pass: reconciles the checkpoint against the live chain,
 * batch-backfills (no undo rows — plan design) down to `tip - UNDO_DEPTH` if
 * far behind, then applies whatever's left one block at a time (undo row per
 * block), re-reconciling and retrying whenever a fetched block's `prevHash`
 * doesn't chain from `state.hash` — a reorg that landed mid-catch-up.
 * Returns once `state.height` has caught up to `getblockcount()` as observed
 * at that moment (a moving tip just means the next `notified()` wakes this up
 * again).
 */
export async function syncOnce(deps: FollowDeps): Promise<SyncResult> {
	const network = deps.network ?? Network.Bitcoin;
	const genesisHeight = deps.genesisHeight ?? GENESIS_HEIGHT;

	let state = await loadState(deps.db);
	if (state.height === undefined && network === Network.Bitcoin) {
		// UNCOMMON•GOODS is mainnet-only — see backfill.ts's runBackfill.
		seedGenesis(state);
	}

	state = await reconcileCheckpoint(deps, state);

	const rawTipHeight = await deps.rpc.getblockcount();
	// Capped at `deps.until` (plan 062) so a bounded `follow --until <H>` never
	// fetches or applies a block past H, even if the live chain has moved on.
	const tipHeight =
		deps.until !== undefined
			? Math.min(rawTipHeight, deps.until)
			: rawTipHeight;
	// `state.height` is `undefined` only for a brand-new database (nothing
	// backfilled yet, ever) — treat that exactly like backfill.ts does (one
	// height below the genesis height), so a fresh `follow` on an empty DB
	// still takes the batched catch-up path instead of walking from the start
	// one block at a time.
	const checkpointHeight = state.height ?? genesisHeight - 1;
	if (tipHeight - checkpointHeight > UNDO_DEPTH) {
		state = await runBackfill({
			db: deps.db,
			rpc: deps.rpc,
			toHeight: tipHeight - UNDO_DEPTH,
			fetchConcurrency: deps.fetchConcurrency ?? 8,
			flushInterval: deps.flushInterval,
			onFlush: deps.onFlush,
			invariantReportDir: deps.invariantReportDir,
			network,
			genesisHeight,
		});
	}

	let blocksApplied = 0;
	for (;;) {
		const rawCurrentTip = await deps.rpc.getblockcount();
		const currentTip =
			deps.until !== undefined
				? Math.min(rawCurrentTip, deps.until)
				: rawCurrentTip;
		const currentHeight = state.height ?? genesisHeight - 1;
		if (currentHeight >= currentTip) break;

		const nextHeight = currentHeight + 1;
		const nextHash = await deps.rpc.getblockhash(nextHeight);
		const hex = await deps.rpc.getblock(nextHash);
		const block = parseBlock(hex);

		try {
			await applyOneBlock(deps, state, nextHeight, block);
		} catch (error) {
			if (!(error instanceof ContinuityError)) throw error;
			// The block at `nextHeight` doesn't chain from `state.hash` — a
			// reorg landed between fetching `currentTip` and fetching this
			// block. Reconcile from the checkpoint and retry this height.
			state = await reconcileCheckpoint(deps, state);
			continue;
		}

		blocksApplied += 1;
		deps.onBlock?.({ height: nextHeight, hash: block.hash });
	}

	return { state, blocksApplied };
}

/** `runFollow`'s heartbeat cadence and staleness threshold (plan 076). */
const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;
const STALE_LAG_BLOCKS = 12;
const STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Tracks `runFollow`'s liveness state across iterations and decides, on each
 * `record()` call, whether it's time to report a heartbeat. Factored out
 * (plan 076) so its interval/staleness bookkeeping is directly unit-testable
 * against an injected clock, without driving a whole `runFollow` loop.
 */
export interface HeartbeatTracker {
	/**
	 * Called once per `runFollow` iteration with the checkpoint `syncOnce`
	 * just produced and the live tip. Always updates the internal staleness
	 * tracking; returns a `HeartbeatInfo` to report only once per
	 * `HEARTBEAT_INTERVAL_MS` of wall-clock time, `undefined` otherwise.
	 */
	record(
		checkpointHeight: number | undefined,
		tipHeight: number,
	): HeartbeatInfo | undefined;
}

/** `now` defaults to `Date.now`; a test passes a fake clock instead. */
export function createHeartbeatTracker(
	now: () => number = Date.now,
): HeartbeatTracker {
	let lastHeartbeatAt = now();
	let staleSince: number | undefined;

	return {
		record(checkpointHeight, tipHeight) {
			const t = now();
			const lag = tipHeight - (checkpointHeight ?? tipHeight);
			staleSince = lag > STALE_LAG_BLOCKS ? (staleSince ?? t) : undefined;

			if (t - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return undefined;
			lastHeartbeatAt = t;

			const stale = staleSince !== undefined && t - staleSince > STALE_AFTER_MS;
			return { checkpointHeight, tipHeight, lag, stale };
		},
	};
}

/**
 * Runs `syncOnce` forever, waking on `notifier.notified()` (a real
 * `waitfornewblock` return, or the fallback poll noticing a new best hash).
 * Runs one pass immediately on start (covers catching up after being
 * offline, and an orphaned checkpoint left over from a previous run) before
 * waiting for the first notification. With no `deps.until`, never returns on
 * its own — the caller stops it via `signal` (an `AbortController`, since
 * `notifier.notified()` doesn't otherwise have a way to be cancelled
 * mid-wait). With `deps.until` set, returns on its own — without ever
 * calling `notifier.notified()` again — the moment the checkpoint reaches
 * that height (plan 062: `follow --until <H>`), so a caller relying on it
 * never has a wait already in flight for `signal` to interrupt.
 *
 * Every iteration also re-reads the live tip (`getblockcount`) and feeds it
 * to a `HeartbeatTracker`, so a run that's genuinely falling behind — not
 * just one that's hung, which the timeout/retry fix in `rpc.ts` now bounds —
 * still produces a signal. A failed liveness check (the extra `getblockcount`
 * call) is swallowed — it's a signal, not the critical path, and `syncOnce`
 * itself is what surfaces a real RPC failure.
 *
 * Calls `ensureReadIndexes` once, before the loop starts (plan 089): a
 * backfill that dropped the two large `rune_events` read indexes and then
 * died mid-run — before its own end-of-run `ensureReadIndexes` — would
 * otherwise leave a follower running against `rune_events` with those
 * indexes missing indefinitely. Idempotent either way (`CREATE INDEX IF NOT
 * EXISTS`), so this is a no-op when they're already there.
 */
export async function runFollow(
	deps: FollowDeps,
	notifier: BlockNotifier,
	signal?: AbortSignal,
): Promise<void> {
	await ensureReadIndexes(deps.db);

	const heartbeat = createHeartbeatTracker(deps.now);

	while (!signal?.aborted) {
		const { state } = await syncOnce(deps);

		if (deps.onHeartbeat) {
			try {
				const tipHeight = await deps.rpc.getblockcount();
				const info = heartbeat.record(state.height, tipHeight);
				if (info) deps.onHeartbeat(info);
			} catch {
				// A failed liveness check shouldn't take down follow itself.
			}
		}

		if (
			deps.until !== undefined &&
			(state.height ?? Number.NEGATIVE_INFINITY) >= deps.until
		) {
			break;
		}

		if (signal?.aborted) break;
		await notifier.notified();
	}
}
