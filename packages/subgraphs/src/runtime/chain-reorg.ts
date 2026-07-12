import type {
	ChainReorgOrphanedEntry,
	ChainReorgRollbackEnvelope,
} from "@secondlayer/shared";
import type {
	Database,
	InsertSubscriptionOutbox,
} from "@secondlayer/shared/db";
import { getTargetDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import { bumpChainReorgGeneration } from "./trigger-evaluator-loop.ts";

/**
 * Reorg handling for direct chain-level subscriptions.
 *
 * `forkHeight` is the shallowest height where the chain diverged; every block
 * `>= forkHeight` we previously processed is now orphaned. Orphaned blocks are
 * NOT re-fetchable from Index (it serves canonical only), so the chain
 * `subscription_outbox` rows we already wrote are the sole record of what we
 * delivered. We therefore:
 *
 *   1. drop still-pending apply rows `>= forkHeight` — never delivered, so no
 *      rollback is owed and we must not ship now-stale events;
 *   2. snapshot the DELIVERED apply rows `>= forkHeight` and emit one
 *      `chain.reorg.rollback` per affected subscription carrying those events so
 *      the consumer can undo precisely;
 *   3. rewind the evaluator cursor to `forkHeight - 1` so apply re-fires for the
 *      new canonical blocks. Surviving txs re-deliver under their new block_hash
 *      (the dedup key includes it); genuinely-orphaned txs do not.
 */

/** Max orphaned events embedded per rollback payload (bounds memory; reorgs are
 *  shallow). Beyond this the payload is marked truncated. */
const MAX_ORPHANED_PER_SUB = 500;

export async function handleChainReorg(
	forkHeight: number,
	db: Kysely<Database> = getTargetDb(),
): Promise<void> {
	// Invalidate any evaluator tick snapshotted before this reorg so its stale
	// forward advance cannot clobber the rewind below (bump before any await, so
	// a concurrent advance taking the cursor lock observes it). Mirrors f057.
	bumpChainReorgGeneration();

	// 1. Drop undelivered applies for orphaned blocks.
	await db
		.deleteFrom("subscription_outbox")
		.where("kind", "=", "chain")
		.where("block_height", ">=", forkHeight)
		.where("status", "=", "pending")
		.where("event_type", "like", "chain.%.apply")
		.execute();

	// 2. Snapshot delivered applies for orphaned blocks, grouped per subscription.
	const delivered = await db
		.selectFrom("subscription_outbox")
		.select(["subscription_id", "tx_id", "payload"])
		.where("kind", "=", "chain")
		.where("block_height", ">=", forkHeight)
		.where("status", "=", "delivered")
		.where("event_type", "like", "chain.%.apply")
		.orderBy("block_height")
		.orderBy("id")
		.execute();

	const bySub = new Map<string, ChainReorgOrphanedEntry[]>();
	for (const row of delivered) {
		const list = bySub.get(row.subscription_id) ?? [];
		const payload = row.payload as { event?: unknown };
		list.push({ tx_id: row.tx_id, event: payload?.event ?? null });
		bySub.set(row.subscription_id, list);
	}

	if (bySub.size > 0) {
		const rows: InsertSubscriptionOutbox[] = [];
		for (const [subscriptionId, entries] of bySub) {
			const truncated = entries.length > MAX_ORPHANED_PER_SUB;
			const payload: ChainReorgRollbackEnvelope = {
				action: "rollback",
				fork_point_height: forkHeight,
				orphaned: truncated ? entries.slice(0, MAX_ORPHANED_PER_SUB) : entries,
				truncated,
			};
			rows.push({
				subscription_id: subscriptionId,
				kind: "chain",
				subgraph_name: null,
				table_name: null,
				block_height: forkHeight,
				tx_id: null,
				row_pk: { fork_point_height: forkHeight },
				event_type: "chain.reorg.rollback",
				payload,
				// One rollback per (subscription, fork) — re-applying the same reorg
				// is a no-op.
				dedup_key: `chainreorg:${subscriptionId}:${forkHeight}`,
			});
		}
		await db
			.insertInto("subscription_outbox")
			.values(rows)
			.onConflict((oc) =>
				oc.columns(["subscription_id", "dedup_key"]).doNothing(),
			)
			.execute();
		logger.info("Chain reorg — emitted rollbacks", {
			forkPointHeight: forkHeight,
			subscriptions: bySub.size,
		});
	}

	// 3. Rewind the evaluator cursor so the new canonical blocks re-fire applies.
	await db.transaction().execute(async (trx) => {
		const cur = await trx
			.selectFrom("trigger_evaluator_state")
			.select("last_processed_block")
			.where("id", "=", true)
			.forUpdate()
			.executeTakeFirst();
		if (cur && Number(cur.last_processed_block) >= forkHeight) {
			await trx
				.updateTable("trigger_evaluator_state")
				.set({ last_processed_block: forkHeight - 1, updated_at: new Date() })
				.where("id", "=", true)
				.execute();
		}
	});
}
