import type {
	ChainReorgOrphanedEntry,
	ChainReorgRollbackEnvelope,
} from "@secondlayer/shared";
import type { Database, InsertWebhookOutbox } from "@secondlayer/shared/db";
import { getTargetDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import { bumpChainReorgGeneration } from "./trigger-evaluator-loop.ts";

/**
 * Reorg handling for direct chain-level webhooks.
 *
 * `forkHeight` is the shallowest height where the chain diverged; every block
 * `>= forkHeight` we previously processed is now orphaned. Orphaned blocks are
 * NOT re-fetchable from Index (it serves canonical only), so the chain
 * `webhook_outbox` rows we already wrote are the sole record of what we
 * delivered. We therefore:
 *
 *   1. classify every apply row `>= forkHeight` under `FOR UPDATE` (so the
 *      emitter's `SKIP LOCKED` claim can't touch one mid-classification):
 *      a row that was ever claimed or attempted MAY have reached the
 *      receiver — `attempt > 0` (a prior try, even if its lock has since
 *      expired) or `locked_until >= NOW()` (claimed, POST possibly still
 *      in flight). Only a row that is `attempt = 0` AND never claimed (or
 *      whose claim lock already expired) is genuinely never-sent and safe
 *      to drop outright.
 *   2. mark every "maybe delivered" pending row `dead` with
 *      `last_error` recording the fork, so it never retries into an
 *      orphaned chain, and fold it into the same rollback snapshot as the
 *      already-`delivered` rows — the receiver may have gotten either;
 *   3. emit one `chain.reorg.rollback` per affected webhook carrying that
 *      snapshot so the consumer can undo precisely;
 *   4. rewind the evaluator cursor to `forkHeight - 1` so apply re-fires for the
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

	// Steps 1-3 run in one transaction: the `FOR UPDATE` select below locks
	// every affected row before any of them are deleted, marked dead, or
	// rolled back, so a concurrent emitter claim (`FOR UPDATE SKIP LOCKED`)
	// simply skips them until this transaction commits — it can never observe
	// a row mid-reclassification.
	await db.transaction().execute(async (trx) => {
		const now = new Date();
		const affected = await trx
			.selectFrom("webhook_outbox")
			.select([
				"id",
				"webhook_id",
				"tx_id",
				"payload",
				"status",
				"attempt",
				"locked_until",
			])
			.where("kind", "=", "chain")
			.where("block_height", ">=", forkHeight)
			.where("event_type", "like", "chain.%.apply")
			.where((eb) =>
				eb.or([eb("status", "=", "pending"), eb("status", "=", "delivered")]),
			)
			.orderBy("block_height")
			.orderBy("id")
			.forUpdate()
			.execute();

		const toDeleteIds: string[] = [];
		const toMarkDeadIds: string[] = [];
		const rollbackRows: {
			webhook_id: string;
			tx_id: string | null;
			payload: unknown;
		}[] = [];

		for (const row of affected) {
			if (row.status === "delivered") {
				rollbackRows.push(row);
				continue;
			}
			// status === "pending"
			const maybeDelivered =
				row.attempt > 0 ||
				(row.locked_until !== null && row.locked_until >= now);
			if (maybeDelivered) {
				toMarkDeadIds.push(row.id);
				rollbackRows.push(row);
			} else {
				toDeleteIds.push(row.id);
			}
		}

		if (toDeleteIds.length > 0) {
			await trx
				.deleteFrom("webhook_outbox")
				.where("id", "in", toDeleteIds)
				.execute();
		}
		if (toMarkDeadIds.length > 0) {
			await trx
				.updateTable("webhook_outbox")
				.set({
					status: "dead",
					failed_at: now,
					last_error: `orphaned by reorg at ${forkHeight}`,
					locked_by: null,
					locked_until: null,
				})
				.where("id", "in", toMarkDeadIds)
				.execute();
		}

		// Snapshot delivered + maybe-delivered applies, grouped per webhook.
		const bySub = new Map<string, ChainReorgOrphanedEntry[]>();
		for (const row of rollbackRows) {
			const list = bySub.get(row.webhook_id) ?? [];
			const payload = row.payload as { event?: unknown };
			list.push({ tx_id: row.tx_id, event: payload?.event ?? null });
			bySub.set(row.webhook_id, list);
		}

		if (bySub.size > 0) {
			const rows: InsertWebhookOutbox[] = [];
			for (const [webhookId, entries] of bySub) {
				const truncated = entries.length > MAX_ORPHANED_PER_SUB;
				const payload: ChainReorgRollbackEnvelope = {
					action: "rollback",
					fork_point_height: forkHeight,
					orphaned: truncated
						? entries.slice(0, MAX_ORPHANED_PER_SUB)
						: entries,
					truncated,
				};
				rows.push({
					webhook_id: webhookId,
					kind: "chain",
					subgraph_name: null,
					table_name: null,
					block_height: forkHeight,
					tx_id: null,
					row_pk: { fork_point_height: forkHeight },
					event_type: "chain.reorg.rollback",
					payload,
					// One rollback per (webhook, fork) — re-applying the same reorg
					// is a no-op.
					dedup_key: `chainreorg:${webhookId}:${forkHeight}`,
				});
			}
			await trx
				.insertInto("webhook_outbox")
				.values(rows)
				.onConflict((oc) => oc.columns(["webhook_id", "dedup_key"]).doNothing())
				.execute();
			logger.info("Chain reorg — emitted rollbacks", {
				forkPointHeight: forkHeight,
				webhooks: bySub.size,
				orphanedPending: toMarkDeadIds.length,
			});
		}
	});

	// 4. Rewind the evaluator cursor so the new canonical blocks re-fire applies.
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
