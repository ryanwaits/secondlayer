import { getSourceDb } from "@secondlayer/shared/db";
import { resolveChainTip } from "@secondlayer/shared/db/queries/integrity";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

export type IndexerStreamsTipBlock = {
	block_height: number;
	block_hash: string;
	burn_block_height: number;
	ts: Date;
};

/**
 * The tip every consumer of the raw plane reads (decoders, Streams, Index,
 * the bulk export): the highest canonical block at or below
 * `last_contiguous_block`. A late-arriving block above a hole must not let
 * a consumer advance its cursor past the missing height, or the hole's
 * events would never be read once it fills. With no `index_progress` row
 * (nothing ingested through `persistBlock` yet) the bound does not apply.
 */
export async function getCurrentCanonicalTip(
	db: Kysely<Database> = getSourceDb(),
): Promise<IndexerStreamsTipBlock | null> {
	const contiguous = await resolveChainTip(db, "contiguous");
	let query = db
		.selectFrom("blocks")
		.select(["height", "hash", "burn_block_height", "timestamp"])
		.where("canonical", "=", true);
	if (contiguous !== null) query = query.where("height", "<=", contiguous);
	const row = await query.orderBy("height", "desc").limit(1).executeTakeFirst();

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
