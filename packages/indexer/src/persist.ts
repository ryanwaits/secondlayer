import { sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { computeContiguousTip } from "@secondlayer/shared/db/queries/integrity";
import type { Insertable, Kysely } from "kysely";
import { removeMempoolTxs } from "./mempool.ts";

// Chunk large batches to stay under the Postgres bind-parameter limit.
const TX_CHUNK_SIZE = 500;
const EVT_CHUNK_SIZE = 1000;

export type PersistBlockInput = {
	block: Insertable<Database["blocks"]>;
	txs: Insertable<Database["transactions"]>[];
	evts: Insertable<Database["events"]>[];
	blockHeight: number;
	/** Defaults to STACKS_NETWORK env (or "mainnet"). */
	network?: string;
};

/**
 * Persist a parsed block + its transactions/events in one atomic transaction.
 *
 * Replace-per-height: `blocks` already upserts by height, but a reorg leaves the
 * orphaned block's transactions/events behind (the inserts only do
 * onConflict-doNothing), so a reused height accumulates duplicate
 * (block_height, tx_index) rows that collide downstream — Streams cursor dupes
 * that wedge the L2 decoders (#46). The node only emits canonical blocks, so we
 * clear the height and re-insert the incoming set. Both
 * transactions_block_height_idx and events_block_height_idx exist, so the
 * deletes are cheap.
 */
/**
 * Copy the transactions/events currently at `blockHeight` into the archive
 * tables before they are replaced by a reorg. `orphanedHash` is the hash of the
 * block being displaced, kept for audit. Idempotent enough for our use — only
 * called on a real hash change.
 */
async function archiveOrphanedHeight(
	tx: Kysely<Database>,
	blockHeight: number,
	orphanedHash: string,
): Promise<void> {
	await sql`
		INSERT INTO transactions_archive (
			tx_id, block_height, tx_index, type, sender, status, contract_id,
			function_name, function_args, raw_result, raw_tx, created_at,
			orphaned_block_hash
		)
		SELECT tx_id, block_height, tx_index, type, sender, status, contract_id,
			function_name, function_args, raw_result, raw_tx, created_at,
			${orphanedHash}
		FROM transactions WHERE block_height = ${blockHeight}
	`.execute(tx);

	await sql`
		INSERT INTO events_archive (
			id, tx_id, block_height, event_index, type, data, created_at,
			orphaned_block_hash
		)
		SELECT id, tx_id, block_height, event_index, type, data, created_at,
			${orphanedHash}
		FROM events WHERE block_height = ${blockHeight}
	`.execute(tx);
}

export async function persistBlock(
	db: Kysely<Database>,
	input: PersistBlockInput,
): Promise<void> {
	const { block, txs, evts, blockHeight } = input;
	const network = input.network ?? process.env.STACKS_NETWORK ?? "mainnet";

	await db.transaction().execute(async (tx) => {
		// A reorg reuses a height with a new block hash. When that happens, the
		// existing rows at this height are orphaned — archive them before the
		// replace so the raw log is preserved, not destroyed. A redelivery of the
		// same hash is not a reorg, so we skip archiving it.
		const existingBlock = await tx
			.selectFrom("blocks")
			.select("hash")
			.where("height", "=", blockHeight)
			.executeTakeFirst();
		const isReorgReplacement =
			existingBlock !== undefined && existingBlock.hash !== block.hash;

		await tx
			.insertInto("blocks")
			.values(block)
			// biome-ignore lint/suspicious/noExplicitAny: kysely onConflict builder
			.onConflict((oc: any) =>
				oc.column("height").doUpdateSet({
					hash: block.hash,
					parent_hash: block.parent_hash,
					burn_block_height: block.burn_block_height,
					burn_block_hash: block.burn_block_hash,
					timestamp: block.timestamp,
					canonical: true,
				}),
			)
			.execute();

		if (isReorgReplacement) {
			await archiveOrphanedHeight(tx, blockHeight, existingBlock.hash);
		}

		// Delete events before transactions: events.tx_id references
		// transactions.tx_id with no ON DELETE CASCADE, so dropping the parent
		// rows first would violate the FK.
		await tx
			.deleteFrom("events")
			.where("block_height", "=", blockHeight)
			.execute();
		await tx
			.deleteFrom("transactions")
			.where("block_height", "=", blockHeight)
			.execute();

		for (let i = 0; i < txs.length; i += TX_CHUNK_SIZE) {
			await tx
				.insertInto("transactions")
				.values(txs.slice(i, i + TX_CHUNK_SIZE))
				// biome-ignore lint/suspicious/noExplicitAny: kysely onConflict builder
				.onConflict((oc: any) => oc.doNothing())
				.execute();
		}

		for (let i = 0; i < evts.length; i += EVT_CHUNK_SIZE) {
			await tx
				.insertInto("events")
				.values(evts.slice(i, i + EVT_CHUNK_SIZE))
				// biome-ignore lint/suspicious/noExplicitAny: kysely onConflict builder
				.onConflict((oc: any) => oc.doNothing())
				.execute();
		}

		// Evict now-confirmed txs from the mempool, in the same transaction so it
		// rolls back with the block on failure. The node doesn't reliably emit a
		// drop for mined txs, so block ingest is the canonical eviction signal.
		await removeMempoolTxs(
			tx,
			txs.map((t) => t.tx_id as string),
		);

		// Compute last_contiguous_block.
		const progressRow = await tx
			.selectFrom("index_progress")
			.select("last_contiguous_block")
			.where("network", "=", network)
			.limit(1)
			.executeTakeFirst();
		const currentContiguous = Number(progressRow?.last_contiguous_block ?? 0);
		let newContiguous = currentContiguous;

		if (blockHeight === currentContiguous + 1) {
			// Next sequential block — extend the contiguous chain.
			newContiguous = await computeContiguousTip(tx, currentContiguous + 1);
		} else if (currentContiguous === 0 && blockHeight > 1) {
			// Indexing from a non-genesis start — find the contiguous run from the
			// lowest block we hold.
			const { rows: minRows } = await sql<{ min_height: string }>`
				SELECT MIN(height) AS min_height FROM blocks WHERE canonical = true
			`.execute(tx);
			const minHeight = Number(minRows[0]?.min_height ?? 0);
			if (minHeight > 0) {
				newContiguous = await computeContiguousTip(tx, minHeight);
			}
		}

		await tx
			.insertInto("index_progress")
			.values({
				network,
				last_indexed_block: blockHeight,
				last_contiguous_block: newContiguous,
				highest_seen_block: blockHeight,
			})
			// biome-ignore lint/suspicious/noExplicitAny: kysely onConflict builder
			.onConflict((oc: any) =>
				oc.column("network").doUpdateSet({
					last_indexed_block: sql`GREATEST(index_progress.last_indexed_block, ${blockHeight})`,
					last_contiguous_block: sql`GREATEST(index_progress.last_contiguous_block, ${newContiguous})`,
					highest_seen_block: sql`GREATEST(index_progress.highest_seen_block, ${blockHeight})`,
					updated_at: new Date(),
				}),
			)
			.execute();
	});
}
