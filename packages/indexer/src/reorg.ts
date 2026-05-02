import { sql } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import type { Transaction } from "kysely";

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
		await tx
			.updateTable("blocks")
			.set({ canonical: false })
			.where("height", ">=", blockHeight)
			.where("canonical", "=", true)
			.execute();

		await sql`SELECT pg_notify('subgraph_reorg', ${JSON.stringify({ blockHeight, oldHash, newHash })})`.execute(
			tx,
		);

		logger.info("Reorganization handled", { blockHeight });
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
