import { getErrorMessage } from "@secondlayer/shared";
import type { Database } from "@secondlayer/shared/db";
import { getTargetDb } from "@secondlayer/shared/db";
import { listActiveChainSubscriptions } from "@secondlayer/shared/db/queries/subscriptions";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import { buildChainBlockSource } from "./block-source.ts";
import {
	buildSourcesMap,
	buildTraitContracts,
	emitChainOutbox,
	emitSbtcOutbox,
	evaluateBlock,
	referencedEventTypes,
} from "./trigger-evaluator.ts";

const CHAIN_SUB_WARN_THRESHOLD = 5000; // observability only — not a cap.

/**
 * The chain-trigger evaluator: a single global loop that drives direct
 * chain-level subscriptions. It reads canonical blocks off the public
 * Index/Streams clock (the same `PublicApiBlockSource` the re-pointed subgraph
 * runtime uses), runs the shared matcher against every active chain
 * subscription, and writes apply-envelope rows to `subscription_outbox` — which
 * the existing emitter then delivers, signed, unchanged.
 *
 * Forward-looking by design: a fresh cursor (or no chain subscriptions) fast-
 * forwards to tip, so subscriptions start at the chain head and never trigger a
 * historical backfill. Reorgs rewind the cursor via `handleChainReorg`.
 */

const POLL_MS = Number(process.env.TRIGGER_EVALUATOR_POLL_MS) || 5_000;
const BATCH = Number(process.env.TRIGGER_EVALUATOR_BATCH) || 200;
// Bound work per tick so a large gap (e.g. after downtime) is caught up in
// steps rather than one huge fetch.
const MAX_BLOCKS_PER_TICK =
	Number(process.env.TRIGGER_EVALUATOR_MAX_BLOCKS) || 2_000;

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
 * `< to` guard serializes concurrent evaluators and ignores a stale advance
 * that races a reorg rewind; `dedup_key` is the duplicate-delivery backstop.
 */
async function advanceCursor(db: Kysely<Database>, to: number): Promise<void> {
	await db.transaction().execute(async (trx) => {
		const cur = await trx
			.selectFrom("trigger_evaluator_state")
			.select("last_processed_block")
			.where("id", "=", true)
			.forUpdate()
			.executeTakeFirst();
		if (cur && Number(cur.last_processed_block) < to) {
			await trx
				.updateTable("trigger_evaluator_state")
				.set({ last_processed_block: to, updated_at: new Date() })
				.where("id", "=", true)
				.execute();
		}
	});
}

/**
 * One catch-up pass: process new canonical blocks for all active chain
 * subscriptions and emit matches. Returns the number of outbox rows written.
 * Extracted from the timer loop for testing.
 */
export async function runEvaluatorOnce(
	db: Kysely<Database> = getTargetDb(),
): Promise<number> {
	const chainSubs = await listActiveChainSubscriptions(db);
	if (chainSubs.length >= CHAIN_SUB_WARN_THRESHOLD) {
		logger.warn("Active chain subscription count is high", {
			event: "chain_sub_load_high",
			count: chainSubs.length,
			threshold: CHAIN_SUB_WARN_THRESHOLD,
		});
	}
	const source = buildChainBlockSource(referencedEventTypes(chainSubs));
	const tip = await source.getTip();
	if (tip <= 0) return 0;

	const cursor = await readCursor(db);
	// Forward-looking: uninitialized cursor or no subscriptions → jump to tip so
	// nothing backfills history.
	if (cursor === 0 || chainSubs.length === 0) {
		await advanceCursor(db, tip);
		return 0;
	}
	if (cursor >= tip) return 0;

	const { sources, keyMeta } = buildSourcesMap(chainSubs);
	const target = Math.min(tip, cursor + MAX_BLOCKS_PER_TICK);
	let emitted = 0;
	for (let from = cursor + 1; from <= target; from = from + BATCH) {
		const to = Math.min(from + BATCH - 1, target);
		const blocks = await source.loadBlockRange(from, to);
		// Trait membership only grows; resolve once per batch as of its top height.
		const traitContracts = await buildTraitContracts(db, chainSubs, to);
		for (let h = from; h <= to; h++) {
			const bd = blocks.get(h);
			if (!bd) continue;
			const matches = evaluateBlock(bd, sources, traitContracts);
			if (matches.length > 0) {
				emitted += await emitChainOutbox(
					db,
					matches,
					keyMeta,
					h,
					bd.block.hash,
				);
			}
			emitted += await emitSbtcOutbox(db, chainSubs, h, bd.block.hash);
		}
		await advanceCursor(db, to);
	}
	return emitted;
}

/** Start the evaluator timer loop. Returns a stop function. */
export function startTriggerEvaluator(): () => void {
	let running = true;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const tick = async (): Promise<void> => {
		if (!running) return;
		try {
			const emitted = await runEvaluatorOnce();
			if (emitted > 0) {
				logger.info("Trigger evaluator emitted chain deliveries", {
					count: emitted,
				});
			}
		} catch (err) {
			logger.error("Trigger evaluator tick failed", {
				error: getErrorMessage(err),
			});
		}
		if (running) timer = setTimeout(tick, POLL_MS);
	};

	timer = setTimeout(tick, POLL_MS);
	logger.info("Trigger evaluator started", { pollMs: POLL_MS });
	return () => {
		running = false;
		if (timer) clearTimeout(timer);
	};
}
