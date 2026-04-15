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

	await db.transaction().execute(async (tx: Transaction<Database>) => {
		await tx
			.updateTable("blocks")
			.set({ canonical: false })
			.where("height", "=", blockHeight)
			.where("hash", "=", oldHash)
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
