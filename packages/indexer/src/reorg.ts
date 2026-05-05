import { sql } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { insertChainReorg } from "@secondlayer/shared/db/queries/chain-reorgs";
import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { Transaction } from "kysely";
import { handleDecodedEventsReorg } from "./l2/storage.ts";

const STREAMS_DB_EVENT_TYPES = [
	"stx_transfer_event",
	"stx_mint_event",
	"stx_burn_event",
	"stx_lock_event",
	"ft_transfer_event",
	"ft_mint_event",
	"ft_burn_event",
	"nft_transfer_event",
	"nft_mint_event",
	"nft_burn_event",
	"smart_contract_event",
] as const;

export async function handleReorg(
	blockHeight: number,
	oldHash: string,
	newHash: string,
): Promise<void> {
	const db = getDb();

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

		const l2Reorg = await handleDecodedEventsReorg(blockHeight, { db: tx });
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

		logger.info("Reorganization handled", { blockHeight, l2Reorg, reorg });
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
	const db = getDb();

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
