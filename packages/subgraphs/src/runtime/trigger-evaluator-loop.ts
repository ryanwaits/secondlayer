import { getErrorMessage } from "@secondlayer/shared";
import type { Database } from "@secondlayer/shared/db";
import { getTargetDb } from "@secondlayer/shared/db";
import { listActiveChainWebhooks } from "@secondlayer/shared/db/queries/webhooks";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import { buildChainBlockSource } from "./block-source.ts";
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
};

export async function runEvaluatorOnce(
	db: Kysely<Database> = getTargetDb(),
): Promise<EvaluatorTickResult> {
	const tickStart = Date.now();
	let emitted = 0;
	let advanced = false;
	let rawTip: number | null = null;
	let boundTip: number | null = null;
	let cursorBefore: number | null = null;
	let cursorAfter: number | null = null;
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
		);
		// sBTC settlement webhooks fire on Bitcoin confirmations, async to Stacks
		// blocks — scan every tick on their own cursor, independent of (and before)
		// the block-cursor early returns below. It touches only local DB state, so
		// it's independent of the tip's HTTP round trip — run them concurrently
		// instead of stacking the DB scan in front of the network hop.
		const [settlementEmitted, tip0] = await Promise.all([
			emitSbtcSettlementOutbox(db, chainSubs),
			source.getTip(),
		]);
		emitted = settlementEmitted;
		rawTip = tip0;
		if (rawTip <= 0) return { emitted, advanced };

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
			return { emitted, advanced };
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
			return { emitted, advanced };
		}
		if (cursor >= tip) return { emitted, advanced };

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
		return { emitted, advanced };
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

/** Start the evaluator timer loop. Returns a stop function. */
export function startTriggerEvaluator(): () => void {
	let running = true;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const tick = async (): Promise<void> => {
		if (!running) return;
		let advanced = false;
		try {
			const result = await runEvaluatorOnce();
			advanced = result.advanced;
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
		if (running) timer = setTimeout(tick, nextTickDelayMs(advanced, POLL_MS));
	};

	timer = setTimeout(tick, POLL_MS);
	logger.info("Trigger evaluator started", { pollMs: POLL_MS });
	return () => {
		running = false;
		if (timer) clearTimeout(timer);
	};
}
