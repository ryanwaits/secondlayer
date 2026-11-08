import { stacksNetwork } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { resetChainTipCache } from "../../src/routes/subgraphs.ts";

/**
 * Give the test database a chain with `height` blocks, so routes that refuse
 * ranges past the tip (backfill) have a tip to compare against. Returns the
 * cleanup that puts the table back.
 */
export async function seedChainTip(
	height: number,
): Promise<() => Promise<void>> {
	const network = stacksNetwork();
	const db = getDb();
	const prior = await db
		.selectFrom("index_progress")
		.selectAll()
		.where("network", "=", network)
		.executeTakeFirst();
	await db
		.insertInto("index_progress")
		.values({
			network,
			last_indexed_block: height,
			last_contiguous_block: height,
			highest_seen_block: height,
		})
		.onConflict((oc) =>
			oc.column("network").doUpdateSet({
				last_indexed_block: height,
				last_contiguous_block: height,
				highest_seen_block: height,
			}),
		)
		.execute();
	resetChainTipCache();
	return async () => {
		if (!prior) {
			await db
				.deleteFrom("index_progress")
				.where("network", "=", network)
				.execute();
		} else {
			await db
				.updateTable("index_progress")
				.set({
					last_indexed_block: prior.last_indexed_block,
					last_contiguous_block: prior.last_contiguous_block,
					highest_seen_block: prior.highest_seen_block,
				})
				.where("network", "=", network)
				.execute();
		}
		resetChainTipCache();
	};
}
