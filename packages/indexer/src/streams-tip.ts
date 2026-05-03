import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

export type IndexerStreamsTipBlock = {
	block_height: number;
	index_block_hash: string;
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
		index_block_hash: row.hash,
		burn_block_height: Number(row.burn_block_height),
		ts: new Date(Number(row.timestamp) * 1000),
	};
}
