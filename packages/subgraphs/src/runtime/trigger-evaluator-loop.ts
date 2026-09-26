import { getErrorMessage } from "@secondlayer/shared";
import type { Database } from "@secondlayer/shared/db";
import { getTargetDb } from "@secondlayer/shared/db";
import { listActiveChainWebhooks } from "@secondlayer/shared/db/queries/webhooks";
import type { IndexHttpClient } from "@secondlayer/shared/index-http";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import { buildChainBlockSource, buildHttpClient } from "./block-source.ts";
import { boundSourceTip } from "./decoder-bound.ts";
import {
	blockTimeOf,
	buildSourcesMap,
	buildTraitContracts,
	chainSubsNeedTransactions,
	emitChainOutbox,
	emitSbtcOutbox,
	emitSbtcSettlementOutbox,
	evaluateBlock,
	referencedDecoderNames,
	referencedEventTypes,
} from "./trigger-evaluator.ts";

const CHAIN_SUB_WARN_THRESHOLD = 5000; // observability only — not a cap.

/**
 * The chain-trigger evaluator: a single global loop that drives direct
 * chain-level webhooks. It reads canonical blocks off the public
 * Index/Streams clock (the same `PublicApiBlockSource` the re-pointed subgraph
 * runtime uses), runs the shared matcher against every active chain
 * webhook, and writes apply-envelope rows to `webhook_outbox` — which
 * the existing emitter then delivers, signed, unchanged.
 *
 * Forward-looking by design: a fresh cursor (or no chain webhooks) fast-
 * forwards to tip, so webhooks start at the chain head and never trigger a
 * historical backfill. Reorgs rewind the cursor via `handleChainReorg`.
 */

const POLL_MS = Number(process.env.TRIGGER_EVALUATOR_POLL_MS) || 5_000;
// Long-poll budget for a tick that finds nothing new — a
// caught-up evaluator holds its tip request open instead of sleeping POLL_MS
// and re-asking. Kept under `MAX_INDEX_WAIT_SECONDS` (25) with headroom.
const WAIT_SECONDS = Number(process.env.TRIGGER_EVALUATOR_WAIT_SECONDS) || 20;
const BATCH = Number(process.env.TRIGGER_EVALUATOR_BATCH) || 200;
// Bound work per tick so a large gap (e.g. after downtime) is caught up in
// steps rather than one huge fetch.
const MAX_BLOCKS_PER_TICK =
	Number(process.env.TRIGGER_EVALUATOR_MAX_BLOCKS) || 2_000;

// A concurrent reorg rewind and the evaluator's forward advance target the same
// cursor row. FOR UPDATE serializes the writes but not the *staleness* of a `to`
// computed before the rewind — so a stale advance could clobber the rewind
// (under-delivery). This in-memory generation counter, bumped by handleChainReorg
// BEFORE it rewinds, lets advanceCursor reject any advance snapshotted before the
// reorg. In-process only: webhook-plane gates the evaluator and the reorg on
// the same leader (see webhook-plane.ts). Mirrors f057's reorgEpoch in catchup.ts.
let chainReorgGeneration = 0;
export function bumpChainReorgGeneration(): void {
	chainReorgGeneration++;
}
export function getChainReorgGeneration(): number {
	return chainReorgGeneration;
}

async function readCursor(db: Kysely<Database>): Promise<number> {
	const row = await db
		.selectFrom("trigger_evaluator_state")
		.select("last_processed_block")
		.where("id", "=", true)
		.executeTakeFirst();
	return row ? Number(row.last_processed_block) : 0;
}

/**
 * Advance the global cursor to `to`, never backwards. The `FOR UPDATE` +
 * `< to` guard serializes concurrent evaluators; the `generation` re-check
 * (inside the same transaction, after FOR UPDATE) rejects an advance whose
 * `to` was computed before a reorg rewound the cursor — see
 * `chainReorgGeneration` above. `dedup_key` is the duplicate-delivery
 * backstop for anything that still slips through.
 */
export async function advanceCursor(
	db: Kysely<Database>,
	to: number,
	generation: number,
): Promise<{ advanced: boolean; reorged: boolean }> {
	return db.transaction().execute(async (trx) => {
		const cur = await trx
			.selectFrom("trigger_evaluator_state")
			.select("last_processed_block")
			.where("id", "=", true)
			.forUpdate()
			.executeTakeFirst();
		if (getChainReorgGeneration() !== generation) {
			return { advanced: false, reorged: true };
		}
		if (cur && Number(cur.last_processed_block) < to) {
			await trx
				.updateTable("trigger_evaluator_state")
				.set({ last_processed_block: to, updated_at: new Date() })
				.where("id", "=", true)
				.execute();
			return { advanced: true, reorged: false };
		}
		return { advanced: false, reorged: false };
	});
}

/**
 * One catch-up pass: process new canonical blocks for all active chain
 * webhooks and emit matches. Returns the number of outbox rows written.
 * Extracted from the timer loop for testing.
 */
export type EvaluatorTickResult = {
	emitted: number;
	/** True when this tick advanced the cursor at least once — a caller can
	 *  use this to re-run immediately instead of waiting out the poll
	 *  interval, so a backlog drains without idle gaps between ticks. */
	advanced: boolean;
	/** Raw (pre-decoder-bound) source tip observed this tick, or `null` when
	 *  the tick bailed before fetching one (no chain webhooks matter here —
	 *  it still fetches to feed sBTC settlement scanning's early returns).
	 *  Fed back as the next tick's `knownTip` so a long-poll has a baseline
	 *  to compare against. */
	rawTip: number | null;
	/** True exactly when this tick found the cursor already at (or past) the
	 *  bound tip — caught up, nothing to process. The next tick can safely
	 *  long-poll instead of sleeping `POLL_MS` blind. False on every other
	 *  return path (no chain data yet, a decoder stall, or a batch that still
	 *  advanced the cursor) so a genuinely stuck evaluator keeps falling back
	 *  to the plain timer instead of long-polling a condition `wait` cannot
	 *  fix. */
	idleAtTip: boolean;
};

export async function runEvaluatorOnce(
	db: Kysely<Database> = getTargetDb(),
	opts?: {
		/** Long-poll the tip fetch this many seconds (clamped server-side to
		 *  `MAX_INDEX_WAIT_SECONDS`) instead of returning immediately. Only
		 *  useful together with `knownTip` — see `BlockSource.getTip`. */
		waitSeconds?: number;
		/** The raw tip THIS evaluator last observed — the baseline `waitSeconds`
		 *  needs to know whether anything has changed. */
		knownTip?: number;
		/** Reused across ticks so `IndexHttpClient.waitIsSupported()`
		 *  reflects this server's real capability instead of resetting on
		 *  every call. Defaults to a fresh client (unchanged behavior) when
		 *  omitted — tests and one-off callers don't need to care. */
		httpClient?: IndexHttpClient;
	},
): Promise<EvaluatorTickResult> {
	const tickStart = Date.now();
	let emitted = 0;
	let advanced = false;
	let idleAtTip = false;
	let rawTip: number | null = null;
	let boundTip: number | null = null;
	let cursorBefore: number | null = null;
	let cursorAfter: number | null = null;
	// Instrumentation only, for `chain_evaluator_tick` (tracing residual
	// decoder-committed → outbox misses): whether this tick asked to long-poll,
	// how long that fetch itself took (isolated from the concurrent settlement
	// scan below), and why it returned.
	const waitRequested = (opts?.waitSeconds ?? 0) > 0;
	let waitMs = 0;
	try {
		// Snapshot BEFORE reading the cursor: a rewind between this read and the
		// cursor read below still trips the guard on the next advanceCursor call
		// (conservative — one wasted tick, never a clobber).
		const generation = getChainReorgGeneration();
		const chainSubs = await listActiveChainWebhooks(db);
		if (chainSubs.length >= CHAIN_SUB_WARN_THRESHOLD) {
			logger.warn("Active chain webhook count is high", {
				event: "chain_sub_load_high",
				count: chainSubs.length,
				threshold: CHAIN_SUB_WARN_THRESHOLD,
			});
		}

		const source = buildChainBlockSource(
			referencedEventTypes(chainSubs),
			chainSubsNeedTransactions(chainSubs),
			opts?.httpClient,
		);
		// sBTC settlement webhooks fire on Bitcoin confirmations, async to Stacks
		// blocks — scan every tick on their own cursor, independent of (and before)
		// the block-cursor early returns below. It touches only local DB state, so
		// it's independent of the tip's HTTP round trip — run them concurrently
		// instead of stacking the DB scan in front of the network hop.
		// `getTip` timed on its own (not the whole Promise.all) so `waitMs` is
		// the wait round trip itself, not inflated or hidden by the concurrent
		// settlement scan racing alongside it.
		const getTipStart = Date.now();
		const [settlementEmitted, tip0] = await Promise.all([
			emitSbtcSettlementOutbox(db, chainSubs),
			source
				.getTip({ wait: opts?.waitSeconds, knownHeight: opts?.knownTip })
				.finally(() => {
					waitMs = Date.now() - getTipStart;
				}),
		]);
		emitted = settlementEmitted;
		rawTip = tip0;
		if (rawTip <= 0) return { emitted, advanced, rawTip, idleAtTip };

		const bound = await boundSourceTip(
			rawTip,
			referencedDecoderNames(chainSubs),
			{
				// Reads the SAME tip envelope the `source.getTip()` call above just
				// fetched (remote mode only) — no second request. Lets the bound
				// narrow to the decoders these webhooks actually reference instead of
				// `rawTip`'s conservative cross-decoder floor, without reintroducing
				// the old per-tick `/public/status` poll.
				remoteDecodedHeights: source.getDecodedHeights?.(),
			},
		);
		if (!bound.ok) {
			logger.warn("Chain evaluator stalled: missing decoder checkpoint", {
				event: "chain_evaluator_decoder_stall",
				missing: bound.missing,
			});
			return { emitted, advanced, rawTip, idleAtTip };
		}
		if (bound.floor !== null && bound.floor < rawTip) {
			logger.debug("Chain evaluator tip bounded by decoder progress", {
				event: "chain_evaluator_decoder_floor",
				rawTip,
				floor: bound.floor,
				tip: bound.tip,
			});
		}
		const tip = bound.tip;
		boundTip = tip;

		const cursor = await readCursor(db);
		cursorBefore = cursor;
		cursorAfter = cursor;
		// Forward-looking: uninitialized cursor or no webhooks → jump to tip so
		// nothing backfills history.
		if (cursor === 0 || chainSubs.length === 0) {
			const res = await advanceCursor(db, tip, generation);
			if (res.advanced) {
				cursorAfter = tip;
				advanced = true;
			}
			return { emitted, advanced, rawTip, idleAtTip };
		}
		if (cursor >= tip) {
			idleAtTip = true;
			return { emitted, advanced, rawTip, idleAtTip };
		}

		const { sources, keyMeta } = buildSourcesMap(chainSubs);
		const target = Math.min(tip, cursor + MAX_BLOCKS_PER_TICK);
		for (let from = cursor + 1; from <= target; from = from + BATCH) {
			const to = Math.min(from + BATCH - 1, target);
			const blocks = await source.loadBlockRange(from, to);
			// Trait membership only grows; resolve once per batch as of its top height.
			const traitContracts = await buildTraitContracts(chainSubs, to);
			for (let h = from; h <= to; h++) {
				const bd = blocks.get(h);
				if (!bd) continue;
				const blockTime = blockTimeOf(bd.block);
				const matches = evaluateBlock(bd, sources, traitContracts);
				if (matches.length > 0) {
					emitted += await emitChainOutbox(
						db,
						matches,
						keyMeta,
						h,
						bd.block.hash,
						blockTime,
					);
				}
				emitted += await emitSbtcOutbox(
					db,
					chainSubs,
					h,
					bd.block.hash,
					blockTime,
				);
			}
			const res = await advanceCursor(db, to, generation);
			if (res.advanced) {
				cursorAfter = to;
				advanced = true;
			}
			if (res.reorged) break;
		}
		return { emitted, advanced, rawTip, idleAtTip };
	} finally {
		// Measurement-only: one info log per tick so Gate 1's per-hop latency
		// numbers (raw tip → bound tip → cursor advance → emit) can be pulled
		// straight from logs, regardless of which early return above fired.
		logger.info("Chain evaluator tick", {
			event: "chain_evaluator_tick",
			raw_tip: rawTip,
			bound_tip: boundTip,
			cursor_before: cursorBefore,
			cursor_after: cursorAfter,
			emitted,
			tick_ms: Date.now() - tickStart,
			// Long-poll tracing (see `classifyWaitOutcome`): whether this tick
			// asked the server to hold the request, the baseline height it sent,
			// how long that fetch itself took, and why it returned when it did.
			wait_requested: waitRequested,
			known_height: opts?.knownTip ?? null,
			wait_ms: waitMs,
			wait_outcome: classifyWaitOutcome({
				waitRequested,
				waitSupported: opts?.httpClient?.waitIsSupported() ?? true,
				knownHeight: opts?.knownTip,
				rawTip,
			}),
		});
	}
}

/**
 * Delay before the next tick. No overlap: the next tick is armed only once
 * this one fully finishes — this just decides how long to wait first. A tick
 * that advanced the cursor means there was a backlog to drain — re-arm
 * immediately (0ms) instead of waiting out the poll interval, so catching up
 * after downtime (or just a slow block) doesn't pay a poll-interval gap
 * between every batch. A tick that made no progress (idle, or stalled on a
 * missing decoder) falls back to the poll timer as before.
 */
export function nextTickDelayMs(advanced: boolean, pollMs: number): number {
	return advanced ? 0 : pollMs;
}

/**
 * Should the tick about to run ask the server to hold its tip request
 * (long-poll) instead of returning immediately? True only when the PREVIOUS
 * tick found nothing to do at the tip (`idleAtTip`) AND the server is still
 * known to support `wait` — an older server already forced a plain answer
 * (see `IndexHttpClient.waitIsSupported`), so a stalled wait capability
 * degrades back to plain polling exactly like never having it.
 */
export function shouldWaitThisTick(
	previousIdleAtTip: boolean,
	waitSupported: boolean,
): boolean {
	return previousIdleAtTip && waitSupported;
}

/**
 * Delay before scheduling the NEXT tick. A tick that itself long-polled
 * already spent its waiting time inside the call — re-arm immediately (0ms)
 * so a caught-up evaluator keeps one continuous long-poll going instead of
 * ALSO sleeping `pollMs` on top of it. A tick that did NOT wait keeps the
 * original timer-based pacing (`nextTickDelayMs`).
 */
export function delayAfterTick(
	usedWait: boolean,
	advanced: boolean,
	pollMs: number,
): number {
	return usedWait ? 0 : nextTickDelayMs(advanced, pollMs);
}

/** Floor (ms) a genuine `wait` round trip must clear before `delayAfterTick`
 *  trusts it enough to re-arm at 0. Deliberately generous relative to any
 *  real network hop (~100ms) but small relative to `WAIT_SECONDS` (20_000ms),
 *  so it only trips on a wait that plainly never held. */
export const MIN_REAL_WAIT_MS = 2_000;

/** Why this tick's tip fetch returned — `chain_evaluator_tick` instrumentation
 *  for classifying a miss (a tick that took far longer than the p50) after the
 *  fact instead of guessing from `tick_ms` alone. */
export type WaitOutcome =
	| "not_requested"
	| "not_supported"
	| "tip_moved"
	| "timeout";

/**
 * Classify why `source.getTip()` returned when it did, from the same signals
 * the tick already has on hand: did it ask to wait at all, did the client
 * still believe the server supports `wait` (a 400 on an earlier call — an
 * older server, or one mid-rollout — flips this false for the rest of the
 * client's life, see `IndexHttpClient.waitIsSupported`), and did the returned
 * tip actually move past the baseline this tick sent.
 *
 * `not_supported` and a fast `timeout` both explain a tick that skipped or
 * cut short a long-poll without new data — the difference matters for tracing
 * a miss: `not_supported` points at the HTTP client/server version skew,
 * `timeout` is the server legitimately reporting nothing new for the full
 * window. `tip_moved` is a genuine wake, whether via NOTIFY or a fresh poll.
 */
export function classifyWaitOutcome(opts: {
	waitRequested: boolean;
	waitSupported: boolean;
	knownHeight: number | undefined;
	rawTip: number | null;
}): WaitOutcome {
	if (!opts.waitRequested) return "not_requested";
	if (!opts.waitSupported) return "not_supported";
	if (
		opts.knownHeight !== undefined &&
		opts.rawTip !== null &&
		opts.rawTip > opts.knownHeight
	) {
		return "tip_moved";
	}
	return "timeout";
}

/**
 * Defense in depth (this is what a real prod regression slipped past): even
 * when the client asked the server to hold the response, NEVER trust that it
 * actually did just because the request "succeeded". A server that answers
 * `wait` requests instantly — a bug, a proxy that strips the param, anything —
 * must never turn `delayAfterTick`'s 0ms re-arm into a busy loop.
 *
 * A wait attempt only counts as real when EITHER it found something new
 * (`!idleAtTipAfter` — an early wake is legitimate, not a sign of breakage)
 * OR it actually consumed close to the time it asked for. Both false means
 * the round trip came back fast AND reported nothing new, which no correct
 * `wait` implementation can do.
 */
export function wasRealWait(
	usedWait: boolean,
	idleAtTipAfter: boolean,
	elapsedMs: number,
	minRealWaitMs: number = MIN_REAL_WAIT_MS,
): boolean {
	if (!usedWait) return false;
	return !idleAtTipAfter || elapsedMs >= minRealWaitMs;
}

/** Start the evaluator timer loop. Returns a stop function. */
export function startTriggerEvaluator(): () => void {
	let running = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	// One client for the whole loop's life (not per tick) so
	// `IndexHttpClient.waitIsSupported()` reflects a real, sticky answer —
	// see `waitOnNextCall` below.
	const httpClient = buildHttpClient();
	// Set once the PREVIOUS tick found nothing to do at the tip: the NEXT tick
	// long-polls instead of sleeping POLL_MS blind and re-asking.
	let waitOnNextCall = false;
	let knownTip: number | undefined;

	const tick = async (): Promise<void> => {
		if (!running) return;
		let advanced = false;
		// Defense in depth against exactly the regression this guards: only
		// re-arm at 0ms when the wait this tick asked for actually held (see
		// `wasRealWait`). Starts false so a thrown/failed tick — no result to
		// judge — always falls back to the plain poll timer.
		let realWait = false;
		const usedWait = shouldWaitThisTick(
			waitOnNextCall,
			httpClient.waitIsSupported(),
		);
		const tickStart = Date.now();
		try {
			const result = await runEvaluatorOnce(undefined, {
				httpClient,
				waitSeconds: usedWait ? WAIT_SECONDS : undefined,
				knownTip: usedWait ? knownTip : undefined,
			});
			advanced = result.advanced;
			if (result.rawTip !== null) knownTip = result.rawTip;
			waitOnNextCall = result.idleAtTip;
			realWait = wasRealWait(
				usedWait,
				result.idleAtTip,
				Date.now() - tickStart,
			);
			if (result.emitted > 0) {
				logger.info("Trigger evaluator emitted chain deliveries", {
					count: result.emitted,
				});
			}
		} catch (err) {
			logger.error("Trigger evaluator tick failed", {
				error: getErrorMessage(err),
			});
		}
		if (running)
			timer = setTimeout(tick, delayAfterTick(realWait, advanced, POLL_MS));
	};

	timer = setTimeout(tick, POLL_MS);
	logger.info("Trigger evaluator started", {
		pollMs: POLL_MS,
		waitSeconds: WAIT_SECONDS,
	});
	return () => {
		running = false;
		if (timer) clearTimeout(timer);
	};
}
