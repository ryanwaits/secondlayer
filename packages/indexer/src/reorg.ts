import { STREAMS_DB_EVENT_TYPES, sql } from "@secondlayer/shared";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { insertChainReorg } from "@secondlayer/shared/db/queries/chain-reorgs";
import { logger } from "@secondlayer/shared/logger";
import type { Transaction } from "kysely";
import { handleBnsReorg } from "./decode/bns-storage.ts";
import { handlePox4Reorg } from "./decode/pox4-storage.ts";
import { handleSbtcReorg } from "./decode/sbtc-storage.ts";
import { handleDecodedEventsReorg } from "./decode/storage.ts";

export async function handleReorg(
	blockHeight: number,
	oldHash: string,
	newHash: string,
): Promise<void> {
	const db = getSourceDb();

	logger.warn("Handling chain reorganization", {
		blockHeight,
		oldHash,
		newHash,
	});

	// Stacks chain reorgs frequently span multiple blocks (microblock reorg
	// followed by an anchor block reorg). When we detect a hash mismatch at
	// `blockHeight` we don't yet know how deep the fork goes — the new
	// chain's parent_hash trail might diverge for many blocks.
	//
	// Conservative approach: mark every block at `blockHeight` AND ABOVE as
	// non-canonical, then let the indexer's normal flow re-establish
	// canonical rows as new-chain blocks arrive. Without the `>=` sweep,
	// stale rows at heights above `blockHeight` would remain `canonical=
	// true` and corrupt subgraph state. The downstream subgraph reorg
	// handler likewise deletes rows `_block_height >= blockHeight`.
	await db.transaction().execute(async (tx: Transaction<Database>) => {
		const affectedTip = await sql<{
			max_height: string | number | null;
		}>`
			SELECT MAX(height) AS max_height
			FROM blocks
			WHERE height >= ${blockHeight}
				AND canonical = true
		`.execute(tx);
		const orphanedToHeight = Number(
			affectedTip.rows[0]?.max_height ?? blockHeight,
		);
		const eventTypeList = sql.join(
			STREAMS_DB_EVENT_TYPES.map((eventType) => sql`${eventType}`),
		);
		const eventCount = await sql<{ count: string | number }>`
			SELECT COUNT(*)::integer AS count
			FROM events
			WHERE block_height = ${orphanedToHeight}
				AND type IN (${eventTypeList})
		`.execute(tx);
		const orphanedToEventIndex = Math.max(
			0,
			Number(eventCount.rows[0]?.count ?? 0) - 1,
		);

		await tx
			.updateTable("blocks")
			.set({ canonical: false })
			.where("height", ">=", blockHeight)
			.where("canonical", "=", true)
			.execute();

		await sql`SELECT pg_notify('subgraph_reorg', ${JSON.stringify({ blockHeight, oldHash, newHash })})`.execute(
			tx,
		);

		// Reconcile every decoded plane in the same tx: the generic decoded_events
		// table plus the per-asset projections (sBTC, pox4, BNS), which share the
		// same dense-cursor reorg hazard and were previously left un-reconciled
		// (their handlers existed but were never called). Each hard-DELETEs >= H
		// and rewinds its decoder checkpoint. Safe when a plane is disabled/empty
		// (deletes 0 rows). See decoded-events-reorg-reconciliation audit.
		const l2Reorg = await handleDecodedEventsReorg(blockHeight, { db: tx });
		const sbtcReorg = await handleSbtcReorg(blockHeight, { db: tx });
		const pox4Reorg = await handlePox4Reorg(blockHeight, { db: tx });
		const bnsReorg = await handleBnsReorg(blockHeight, { db: tx });
		const reorg = await insertChainReorg({
			db: tx,
			forkPointHeight: blockHeight,
			oldIndexBlockHash: oldHash,
			newIndexBlockHash: newHash,
			orphanedFrom: { block_height: blockHeight, event_index: 0 },
			orphanedTo: {
				block_height: orphanedToHeight,
				event_index: orphanedToEventIndex,
			},
			newCanonicalTip: { block_height: blockHeight, event_index: 0 },
		});

		logger.info("Reorganization handled", {
			blockHeight,
			l2Reorg,
			sbtcReorg,
			pox4Reorg,
			bnsReorg,
			reorg,
		});
	});
}

/**
 * Detects if a new block represents a reorganization
 * Returns true if reorg detected
 */
export async function detectReorg(
	blockHeight: number,
	newHash: string,
): Promise<{ isReorg: boolean; oldHash?: string }> {
	const db = getSourceDb();

	const existingBlock = await db
		.selectFrom("blocks")
		.selectAll()
		.where("height", "=", blockHeight)
		.where("canonical", "=", true)
		.limit(1)
		.executeTakeFirst();

	if (!existingBlock) {
		return { isReorg: false };
	}

	if (existingBlock.hash !== newHash) {
		return {
			isReorg: true,
			oldHash: existingBlock.hash,
		};
	}

	return { isReorg: false };
}
