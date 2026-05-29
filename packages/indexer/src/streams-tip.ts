import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

export type IndexerStreamsTipBlock = {
	block_height: number;
	block_hash: string;
	burn_block_height: number;
	ts: Date;
};

export async function getCurrentCanonicalTip(
	db: Kysely<Database> = getSourceDb(),
): Promise<IndexerStreamsTipBlock | null> {
	const row = await db
		.selectFrom("blocks")
		.select(["height", "hash", "burn_block_height", "timestamp"])
		.where("canonical", "=", true)
		.orderBy("height", "desc")
		.limit(1)
		.executeTakeFirst();

	if (!row) return null;

	return {
		block_height: Number(row.height),
		block_hash: row.hash,
		burn_block_height: Number(row.burn_block_height),
		ts: new Date(Number(row.timestamp) * 1000),
	};
}

/**
 * Highest canonical Stacks block height whose anchoring burn block is at or
 * below `finalizedBurnHeight` — i.e. the finality boundary in Stacks-height
 * space. Nakamoto packs many Stacks blocks into one burn block, so this maps
 * the burn-confirmation boundary (see `@secondlayer/shared` `finalizedBurnHeight`)
 * to the highest Stacks height a consumer can treat as immutable.
 *
 * Returns 0 when no canonical block is finalized yet.
 */
export async function getFinalizedStacksHeight(
	finalizedBurnHeight: number,
	db: Kysely<Database> = getSourceDb(),
): Promise<number> {
	const row = await db
		.selectFrom("blocks")
		.select("height")
		.where("canonical", "=", true)
		.where("burn_block_height", "<=", finalizedBurnHeight)
		.orderBy("height", "desc")
		.limit(1)
		.executeTakeFirst();

	return row ? Number(row.height) : 0;
}
