import { getErrorMessage } from "@secondlayer/shared";
import { getTargetDb } from "@secondlayer/shared/db";
import type { Subgraph } from "@secondlayer/shared/db";
import {
	listSubgraphs,
	resolveSubgraphRawClient,
} from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import { pgSchemaName } from "../schema/utils.ts";
import type { SubgraphDefinition, SubgraphSchema } from "../types.ts";
import { processBlock } from "./block-processor.ts";

/**
 * Handle a chain reorg for all active subgraphs.
 *
 * `blockHeight` is the **shallowest** height where the chain diverged. The
 * indexer's `handleReorg` has already marked every block ≥ `blockHeight`
 * as non-canonical (a Stacks reorg can span many blocks). We mirror that
 * here: delete rows where `_block_height >= blockHeight` from every
 * subgraph table, then reprocess `blockHeight` (subsequent heights will
 * be reprocessed as the indexer ingests new-chain blocks).
 *
 * Subscription receivers that already consumed the now-reverted events
 * need to know about the rollback. We emit one `<table>.reverted` event
 * per affected table per subscription. The receiver is expected to
 * reverse any side-effects keyed on the rolled-back rows; if they ignore
 * revert events, at least we provided the signal.
 */
export async function handleSubgraphReorg(
	blockHeight: number,
	loadSubgraphDef: (sg: Subgraph) => Promise<SubgraphDefinition>,
): Promise<void> {
	// The subgraphs registry + revert-event outbox live on the managed target
	// DB; the row SELECT/DELETE target each subgraph's data plane (the user's DB
	// for BYO), resolved per subgraph inside the loop.
	const targetDb = getTargetDb();
	const activeSubgraphs = (await listSubgraphs(targetDb)).filter(
		(v: Subgraph) => v.status === "active",
	);

	if (activeSubgraphs.length === 0) return;

	logger.info("Propagating reorg to subgraphs", {
		blockHeight,
		subgraphCount: activeSubgraphs.length,
	});

	for (const sg of activeSubgraphs) {
		try {
			const schema = sg.definition.schema as SubgraphSchema | undefined;
			if (!schema) continue;

			const schemaName = sg.schema_name ?? pgSchemaName(sg.name);
			// Rows live on the subgraph's data plane — user DB for BYO, else target.
			const client = resolveSubgraphRawClient(sg);

			// Snapshot affected rows BEFORE deletion so we can surface them
			// to subscription receivers as revert events. Cap at 1k rows
			// per (table, reorg) to bound memory; deeper reverts are rare
			// and at-volume the receiver should be reading from the table
			// directly anyway.
			const tableNames = Object.keys(schema);
			const revertedByTable: Record<string, unknown[]> = {};
			for (const tableName of tableNames) {
				const rows = await client.unsafe<unknown[]>(
					`SELECT * FROM "${schemaName}"."${tableName}" WHERE "_block_height" >= $1 LIMIT 1000`,
					[blockHeight],
				);
				if (rows.length > 0) revertedByTable[tableName] = rows;
			}

			// Revert table state. With a journal: restore each touched row to its
			// pre-fork state (accumulators keep their history — fix-f040 B2), then
			// sweep append-only rows created at/after the fork. Without one
			// (pre-journal deploy), fall back to the height sweep alone — correct
			// only for append-only tables.
			const hasJournal = (
				await client.unsafe<{ r: unknown }[]>(
					`SELECT to_regclass('"${schemaName}"."_journal"') AS r`,
				)
			)[0]?.r;
			if (hasJournal) {
				await client.begin(async (tx) => {
					for (const tableName of tableNames) {
						// Pre-fork state per row = prev_row of the EARLIEST journal
						// entry at/after the fork (pre-images compose: the first one
						// captured is the state before any fork-era op touched it).
						// prev_row NULL = the row was created in the fork era.
						const earliest = `
							SELECT DISTINCT ON (row_key) row_key, prev_row
							FROM "${schemaName}"."_journal"
							WHERE block_height >= $1 AND table_name = $2
							ORDER BY row_key, _jid ASC`;
						// 1. Drop the current (orphaned) versions of journaled rows.
						await tx.unsafe(
							`DELETE FROM "${schemaName}"."${tableName}" t USING (${earliest}) e WHERE to_jsonb(t.*) @> e.row_key`,
							[blockHeight, tableName],
						);
						// 2. Sweep append-only rows born at/after the fork.
						await tx.unsafe(
							`DELETE FROM "${schemaName}"."${tableName}" WHERE "_block_height" >= $1`,
							[blockHeight],
						);
						// 3. Restore pre-fork row states (pure SQL — NUMERIC precision
						// never round-trips through JS). Restored rows were created
						// pre-fork, so step 2 cannot have matched them.
						await tx.unsafe(
							`INSERT INTO "${schemaName}"."${tableName}"
							 SELECT r.* FROM (${earliest}) e
							 CROSS JOIN LATERAL jsonb_populate_record(NULL::"${schemaName}"."${tableName}", e.prev_row) r
							 WHERE e.prev_row IS NOT NULL`,
							[blockHeight, tableName],
						);
					}
					await tx.unsafe(
						`DELETE FROM "${schemaName}"."_journal" WHERE block_height >= $1`,
						[blockHeight],
					);
				});
			} else {
				logger.warn(
					"Subgraph has no revert journal — falling back to height delete (accumulator rows may lose history)",
					{ subgraph: sg.name, blockHeight },
				);
				for (const tableName of tableNames) {
					await client.unsafe(
						`DELETE FROM "${schemaName}"."${tableName}" WHERE "_block_height" >= $1`,
						[blockHeight],
					);
				}
			}

			// Emit revert events to dependent subscriptions so receivers
			// know to roll back. Insert into subscription_outbox with a
			// stable dedup_key keyed on (subscription, table, height,
			// "revert") so a duplicate reorg notification is a no-op.
			for (const [tableName, rows] of Object.entries(revertedByTable)) {
				if (rows.length === 0) continue;
				await targetDb
					.insertInto("subscription_outbox")
					.columns([
						"subscription_id",
						"event_type",
						"payload",
						"dedup_key",
						"row_pk",
						"status",
					])
					.expression((eb) =>
						eb
							.selectFrom("subscriptions")
							.select((eb2) => [
								"id as subscription_id",
								eb2.val(`${sg.name}.${tableName}.reverted`).as("event_type"),
								eb2
									.val(
										JSON.stringify({
											subgraph: sg.name,
											table: tableName,
											reorgFromHeight: blockHeight,
											rows,
										}),
									)
									.as("payload"),
								eb2
									.val(`reorg:${sg.name}:${tableName}:${blockHeight}`)
									.as("dedup_key"),
								eb2
									.val({
										subgraph: sg.name,
										table: tableName,
										reorgRoot: blockHeight,
									})
									.as("row_pk"),
								eb2.val("pending").as("status"),
							])
							.where("subgraph_name", "=", sg.name)
							.where("table_name", "=", tableName)
							.where("status", "=", "active"),
					)
					.onConflict((oc) => oc.column("dedup_key").doNothing())
					.execute()
					.catch((err) => {
						// Don't fail the reorg cleanup if the revert event
						// emission errors — subscriptions can't be more
						// broken than they were pre-reorg.
						logger.warn("Failed to emit revert event for subscriptions", {
							subgraph: sg.name,
							table: tableName,
							blockHeight,
							error: getErrorMessage(err),
						});
					});
			}

			logger.info("Subgraph reorg cleanup done", {
				subgraph: sg.name,
				blockHeight,
				tablesAffected: Object.keys(revertedByTable).length,
			});

			// Reprocess the new canonical block. Subsequent blocks above
			// `blockHeight` will be reprocessed as the indexer ingests
			// them — they're already marked non-canonical by handleReorg.
			const def = await loadSubgraphDef(sg);
			await processBlock(def, sg.name, blockHeight);

			logger.info("Subgraph reorg reprocessed", {
				subgraph: sg.name,
				blockHeight,
			});
		} catch (err) {
			logger.error("Subgraph reorg handling failed", {
				subgraph: sg.name,
				blockHeight,
				error: getErrorMessage(err),
			});
		}
	}
}
